mod hotkey;

use hotkey::HotkeyStatus;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_sql::{Migration, MigrationKind};

const NEW_NOTE_MENU_ITEM: &str = "new-note";
const VIEW_NOTES_MENU_ITEM: &str = "view-notes";
const QUIT_MENU_ITEM: &str = "quit";

/// The window labels the frontend routes on — see `src/views/route.ts`.
const CAPTURE_WINDOW: &str = "capture";
const HISTORY_WINDOW: &str = "history";

/// Told to the capture window every time it is shown. It is long-lived, so it
/// clears its field and takes focus on this rather than on being built — see
/// docs/adr/0002-capture-window-is-hidden-never-closed.md.
const CAPTURE_SHOWN_EVENT: &str = "capture://shown";

/// Relative, so plugin-sql resolves it inside the app's data directory and the
/// journal survives a restart of the app and of the machine.
const DATABASE_URL: &str = "sqlite:work-journal.db";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Registered first, deliberately: a second launch must exit here,
        // before it can build a second tray icon or fail to register the
        // Hotkey. It is an Entry Point rather than a no-op, so launching the
        // app while it is running starts a Capture in the surviving instance
        // instead of appearing to fail silently.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            start_capture(app);
        }))
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations(DATABASE_URL, migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![dismiss_capture, hotkey_status])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            // Menu bar only: no Dock icon and no Cmd+Tab entry.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Before the capture window, so that the window's webview cannot
            // ask for the Hotkey's status before there is one to hand it.
            register_hotkey(app.handle());

            // Built once, here, and thereafter only shown and hidden. Booting a
            // webview costs a few hundred milliseconds a Capture cannot afford.
            build_capture_window(app.handle())?;
            build_tray(app.handle())?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// The schema lives in `.sql` files rather than Rust string literals so the
/// test suite can build its database from the very same files.
fn migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create notes",
        sql: include_str!("../migrations/0001_create_notes.sql"),
        kind: MigrationKind::Up,
    }]
}

fn build_capture_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, CAPTURE_WINDOW, WebviewUrl::default())
        .title("New Note")
        .inner_size(560.0, 64.0)
        .resizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .center()
        .visible(false)
        .build()?;

    Ok(())
}

/// What every Entry Point does. Each of the three reaches the same single
/// place, and none of them can fail loudly enough to be worth more than a log:
/// the user asked for a Capture, not for an error.
fn start_capture(app: &tauri::AppHandle) {
    if let Err(error) = show_capture_window(app) {
        log::error!("could not start a Capture: {error}");
    }
}

/// The window is already alive, so showing it is all that is left. Focus is
/// requested explicitly because a Dock-less app does not reliably receive it
/// when a window becomes visible.
fn show_capture_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(CAPTURE_WINDOW) else {
        log::error!("the capture window is missing");
        return Ok(());
    };

    // An Entry Point reached during a Capture already in progress is a no-op,
    // not a fresh start: showing again would clear a line the user is halfway
    // through typing.
    if window.is_visible()? {
        return window.set_focus();
    }

    // Dismissing a Capture hides the whole app to hand focus back, so the app
    // itself has to be brought out of hiding before its window can be seen.
    #[cfg(target_os = "macos")]
    app.show()?;

    window.show()?;
    window.set_focus()?;
    window.emit(CAPTURE_SHOWN_EVENT, ())?;

    Ok(())
}

/// Opens History, building the window if it is not already open. Unlike the
/// capture window this one is created on demand and genuinely closed on
/// dismiss — see docs/adr/0002-capture-window-is-hidden-never-closed.md.
fn open_history(app: &tauri::AppHandle) {
    if let Err(error) = show_history_window(app) {
        log::error!("could not open History: {error}");
    }
}

fn show_history_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    // Dismissing a Capture hides the whole app, so the app itself has to be
    // brought out of hiding first — on either path, since `show()` on a window
    // of a hidden application puts nothing on screen.
    #[cfg(target_os = "macos")]
    app.show()?;

    // Reaching the Tray Menu again with History already open raises it rather
    // than building a second one.
    if let Some(window) = app.get_webview_window(HISTORY_WINDOW) {
        window.show()?;
        return window.set_focus();
    }

    let window = WebviewWindowBuilder::new(app, HISTORY_WINDOW, WebviewUrl::default())
        .title("Notes")
        .inner_size(520.0, 620.0)
        .min_inner_size(380.0, 320.0)
        .center()
        .build()?;

    // A Dock-less app does not reliably receive focus when a window appears.
    window.set_focus()?;

    Ok(())
}

/// Registers the Hotkey and records the outcome where the rest of the app can
/// read it. A registration macOS withholds must not take the app down with it:
/// the Tray Menu still starts a Capture, and Settings reports the failure later.
fn register_hotkey(app: &tauri::AppHandle) {
    let handle = app.clone();
    let status = hotkey::register(hotkey::DEFAULT_HOTKEY, |hotkey| {
        app.global_shortcut()
            .on_shortcut(hotkey, move |_app, _shortcut, event| {
                // Press and release both arrive; one Capture per press.
                if event.state() == ShortcutState::Pressed {
                    start_capture(&handle);
                }
            })
    });

    if let HotkeyStatus::Unavailable { hotkey, reason } = &status {
        log::error!("the Hotkey {hotkey} is unavailable: {reason}");
    }

    app.manage(status);
}

/// The Hotkey's availability, for whichever window asks — Settings, once it
/// exists, reports a failed registration to the user.
#[tauri::command]
fn hotkey_status(status: tauri::State<'_, HotkeyStatus>) -> HotkeyStatus {
    status.inner().clone()
}

/// Ends a Capture, whether it committed a Note or discarded one. The window is
/// only ever hidden — see docs/adr/0002-capture-window-is-hidden-never-closed.md.
#[tauri::command]
fn dismiss_capture(app: tauri::AppHandle) -> Result<(), String> {
    hide_capture_window(&app).map_err(|error| error.to_string())
}

fn hide_capture_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(CAPTURE_WINDOW) {
        window.hide()?;
    }

    // Hiding the window leaves this app active, so the user would be left
    // typing into nothing. Hiding the app hands focus back to whatever was in
    // front when the Capture began.
    #[cfg(target_os = "macos")]
    app.hide()?;

    Ok(())
}

/// The Tray Menu — the Entry Point that always works. It gains Settings as that
/// arrives; Quit is here because without a Dock icon it is the only way out.
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let new_note = MenuItem::with_id(app, NEW_NOTE_MENU_ITEM, "New Note", true, None::<&str>)?;
    let view_notes =
        MenuItem::with_id(app, VIEW_NOTES_MENU_ITEM, "View Notes", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, QUIT_MENU_ITEM, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&new_note, &view_notes, &separator, &quit])?;

    let mut tray = TrayIconBuilder::with_id("tray")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id().as_ref() {
            NEW_NOTE_MENU_ITEM => start_capture(app),
            VIEW_NOTES_MENU_ITEM => open_history(app),
            QUIT_MENU_ITEM => app.exit(0),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;

    Ok(())
}
