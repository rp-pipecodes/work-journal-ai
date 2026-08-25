mod calendar;
mod export;
mod hotkey;

use calendar::{Access, CalendarEvent, CalendarInfo};
use export::ExportedFile;
use hotkey::{HotkeyAction, Hotkeys};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::Color,
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_sql::{Migration, MigrationKind};
use tauri_plugin_store::StoreExt;

/// The menu bar glyph, compiled in so the tray never depends on a file on disk.
const TRAY_ICON: &[u8] = include_bytes!("../icons/tray-icon.png");

/// The one tray icon, named so the count can find it again after it is built.
const TRAY_ID: &str = "tray";

const NEW_NOTE_MENU_ITEM: &str = "new-note";
const NEW_TASK_MENU_ITEM: &str = "new-task";

const VIEW_NOTES_MENU_ITEM: &str = "view-notes";
const VIEW_TASKS_MENU_ITEM: &str = "view-tasks";
const COPY_YESTERDAY_DIGEST_MENU_ITEM: &str = "copy-yesterday-digest";
const SETTINGS_MENU_ITEM: &str = "settings";
const QUIT_MENU_ITEM: &str = "quit";

/// The window labels the frontend routes on — see `src/views/route.ts`.
const CAPTURE_WINDOW: &str = "capture";
const TASK_CREATION_WINDOW: &str = "task-creation";
const HISTORY_WINDOW: &str = "history";
const TASKS_WINDOW: &str = "tasks";
const SETTINGS_WINDOW: &str = "settings";

/// Where the settings live. Written from both sides — see
/// `src/settings/tauri-settings.ts` — which is acceptable only because v1 has
/// no secrets in it; see docs/adr/0001-defer-voice-capture-to-v2.md.
const SETTINGS_FILE: &str = "settings.json";

/// The Note Hotkey. Claimed from the OS rather than merely stored, so this
/// side owns both registering it and remembering it. Named without
/// qualification because it predates the Task Hotkey and an existing user's
/// chosen combination has to survive the upgrade untouched.
const HOTKEY_KEY: &str = "hotkey";

/// The Task Hotkey, stored beside it and independent in every other respect.
const TASK_HOTKEY_KEY: &str = "taskHotkey";

/// Whether the app starts at login. Only its presence is read here: an absent
/// answer is a first run, and a first run is when the question gets asked.
const START_AT_LOGIN_KEY: &str = "startAtLogin";

/// The Theme the user settled on. Must match `THEME_KEY` in
/// `src/platform/desktop.ts`.
const THEME_KEY: &str = "theme";

/// Told to the capture window every time it is shown. It is long-lived, so it
/// clears its field and takes focus on this rather than on being built — see
/// docs/adr/0002-capture-window-is-hidden-never-closed.md.
const CAPTURE_SHOWN_EVENT: &str = "capture://shown";

/// Told to the Task Creation window every time it is shown, for the same
/// reason: it is resident and hidden between uses rather than rebuilt — see
/// docs/adr/0019-task-creation-has-its-own-resident-window.md. Must match
/// `TASK_CREATION_SHOWN_EVENT` in `src/platform/desktop.ts`.
const TASK_CREATION_SHOWN_EVENT: &str = "task-creation://shown";

/// Asked of the capture window when the Tray Menu wants yesterday's Digest.
/// This side owns the menu but not the Notes — they are only reachable through
/// plugin-sql from a webview — so the tray asks and the window answers. The
/// capture window is the one that is always there to hear it; see
/// docs/adr/0002-capture-window-is-hidden-never-closed.md. Must match
/// `COPY_YESTERDAY_DIGEST_EVENT` in `src/platform/desktop.ts`.
const COPY_YESTERDAY_DIGEST_EVENT: &str = "digest://yesterday";

/// The machine woke from sleep, so anything that looks at the world afresh has
/// to look again — Import above all, since a lid closed before a meeting ended
/// would otherwise lose that meeting for good. Must match `SYSTEM_WOKE_EVENT`
/// in `src/platform/desktop.ts`.
const SYSTEM_WOKE_EVENT: &str = "system://woke";

/// Relative, so plugin-sql resolves it inside the app's data directory and the
/// journal survives a restart of the app and of the machine.
const DATABASE_URL: &str = "sqlite:work-journal.db";

/// The two Entry Point items of the Tray Menu, held so that remapping either
/// Hotkey can update the combination shown beside its own item.
struct NewNoteMenuItem(MenuItem<tauri::Wry>);
struct NewTaskMenuItem(MenuItem<tauri::Wry>);

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
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations(DATABASE_URL, migrations())
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            dismiss_capture,
            start_task_creation,
            dismiss_task_creation,
            hotkey_status,
            set_hotkey,
            export_journal,
            show_tray_count,
            calendar_access,
            request_calendar_access,
            calendars,
            todays_calendar_events
        ])
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

            // Before the resident windows, so that neither webview can ask for
            // a Hotkey's status before there is one to hand it.
            register_hotkeys(app.handle());

            // Built once, here, and thereafter only shown and hidden. Booting a
            // webview costs a few hundred milliseconds a Capture cannot afford,
            // and the two windows are separate so that unfinished text in one
            // survives the other being used — see
            // docs/adr/0019-task-creation-has-its-own-resident-window.md.
            build_capture_window(app.handle())?;
            build_task_creation_window(app.handle())?;
            build_tray(app.handle())?;

            // Told to whichever window is sweeping the calendar. Set up after
            // the capture window, because that is the window that hears it.
            #[cfg(target_os = "macos")]
            watch_for_wake(app.handle());

            // Start at login is offered once, and only once: the app must
            // never add itself to the login items without being asked, and
            // must not keep asking after being told no.
            if !has_answered_start_at_login(app.handle()) {
                open_settings(app.handle());
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// The schema lives in `.sql` files rather than Rust string literals so the
/// test suite can build its database from the very same files.
fn migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "create notes",
            sql: include_str!("../migrations/0001_create_notes.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "notes project",
            sql: include_str!("../migrations/0002_notes_project.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "note origin and imported meetings",
            sql: include_str!("../migrations/0003_note_origin_and_imported_meetings.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "create tasks",
            sql: include_str!("../migrations/0004_create_tasks.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

fn build_capture_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, CAPTURE_WINDOW, WebviewUrl::default())
        .title("New Note")
        // Larger than the panel the user sees: the view draws the panel's own
        // drop shadow, and a window sized to the panel would clip it. Must
        // match `CAPTURE_WIDTH` and `CAPTURE_HEIGHT` in `src/platform/desktop.ts`.
        .inner_size(626.0, 130.0)
        .resizable(false)
        .decorations(false)
        // The rounded corners and the shadow are drawn by the view, so the
        // window itself has to let the desktop through outside them — and must
        // not draw a second shadow of its own around the whole frame.
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .center()
        .visible(false)
        .build()?;

    Ok(())
}

/// The Task Creation window, built exactly like the capture one and for the
/// same reason. It is a second window rather than a second mode of the first:
/// an unfinished Capture and an unfinished Task Creation must both survive the
/// other being used — see
/// docs/adr/0019-task-creation-has-its-own-resident-window.md.
fn build_task_creation_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, TASK_CREATION_WINDOW, WebviewUrl::default())
        .title("New Task")
        // Must match `CAPTURE_WIDTH` and the resting height in
        // `src/platform/desktop.ts`: the two panels are the same shape.
        .inner_size(626.0, 130.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
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

/// What every Task Entry Point does — the Task Hotkey, New Task in the Tray
/// Menu, and the New Task control in Tasks View all arrive here.
fn start_task_creation_window(app: &tauri::AppHandle) {
    if let Err(error) = show_task_creation_window(app) {
        log::error!("could not start a Task Creation: {error}");
    }
}

fn show_task_creation_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(TASK_CREATION_WINDOW) else {
        log::error!("the Task Creation window is missing");
        return Ok(());
    };

    // An Entry Point reached during a Task Creation already in progress focuses
    // the window rather than resetting it: showing again would clear a
    // description the user is halfway through typing.
    if window.is_visible()? {
        return window.set_focus();
    }

    #[cfg(target_os = "macos")]
    app.show()?;

    window.show()?;
    window.set_focus()?;
    window.emit(TASK_CREATION_SHOWN_EVENT, ())?;

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
    show_on_demand_window(app, HISTORY_WINDOW, "Notes", (520.0, 620.0), (380.0, 320.0))
}

/// A window built the first time it is asked for and raised every time after,
/// until it is dismissed and genuinely closed. The two windows that work this
/// way — History and Settings — differ only in their label and their size; the
/// awkward parts are the same for both, so they are only written once.
fn show_on_demand_window(
    app: &tauri::AppHandle,
    label: &str,
    title: &str,
    size: (f64, f64),
    min_size: (f64, f64),
) -> tauri::Result<()> {
    // Dismissing a Capture hides the whole app, so the app itself has to be
    // brought out of hiding first — on either path, since `show()` on a window
    // of a hidden application puts nothing on screen.
    #[cfg(target_os = "macos")]
    app.show()?;

    // Reaching the Tray Menu again with the window already open raises it
    // rather than building a second one.
    if let Some(window) = app.get_webview_window(label) {
        window.show()?;
        return window.set_focus();
    }

    // A window opens on whatever it was built with and keeps it until its
    // webview has something of its own to show — a fifth of a second later. Both
    // of these are about that gap: the window is painted the palette it is
    // going to end up in, and the webview is told which one that is before it
    // parses a line of the document, so its first frame is already right.
    let theme = resolved_theme(app);

    let builder = WebviewWindowBuilder::new(app, label, WebviewUrl::default())
        .title(title)
        .inner_size(size.0, size.1)
        .min_inner_size(min_size.0, min_size.1)
        .center()
        .background_color(theme.background())
        .initialization_script(theme.announcement());

    // The window is handed its own title bar: the traffic lights are inset over
    // the view rather than sitting in a bar of their own, and the title is left
    // unsaid, because every one of these windows already says what it is. The
    // view leaves the buttons a strip to sit in — see
    // `src/components/WindowTitleBar.tsx`. The Capture window is not built here
    // and keeps its own chrome, which is none at all.
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);

    let window = builder.build()?;

    // A Dock-less app does not reliably receive focus when a window appears.
    window.set_focus()?;

    Ok(())
}

/// Opens Tasks View, building the window if it is not already open. It may sit
/// beside History: Tasks are organized prospectively and Notes retrospectively,
/// so neither window answers the other's question.
fn open_tasks(app: &tauri::AppHandle) {
    if let Err(error) = show_tasks_window(app) {
        log::error!("could not open Tasks: {error}");
    }
}

fn show_tasks_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    show_on_demand_window(app, TASKS_WINDOW, "Tasks", (520.0, 620.0), (380.0, 320.0))
}

/// Opens Settings, building the window if it is not already open. Created on
/// demand and genuinely closed on dismiss, like History.
fn open_settings(app: &tauri::AppHandle) {
    if let Err(error) = show_settings_window(app) {
        log::error!("could not open Settings: {error}");
    }
}

fn show_settings_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    show_on_demand_window(
        app,
        SETTINGS_WINDOW,
        "Settings",
        (480.0, 560.0),
        (400.0, 420.0),
    )
}

/// The Resolved Theme — the palette actually painted, never `system`; see
/// [CONTEXT.md](../../CONTEXT.md). Worked out here as well as in
/// `src/settings/theme.ts` because a window needs its palette *before* it has a
/// webview, which is the one question the frontend cannot answer in time.
#[derive(Clone, Copy)]
enum ResolvedTheme {
    Light,
    Dark,
}

impl ResolvedTheme {
    /// What the window itself is painted while its webview has nothing to show
    /// — `--background` from `src/index.css`, in sRGB. Tauri's default is
    /// white, which in a dark app is a flash of the wrong colour on every open.
    fn background(self) -> Color {
        match self {
            Self::Dark => Color(10, 10, 10, 255),
            Self::Light => Color(255, 255, 255, 255),
        }
    }

    /// Handed to the webview before its document is parsed, so the very first
    /// frame is painted in the right palette rather than repainted into it.
    /// Must match `__THEME__` in `src/platform/desktop.ts`.
    fn announcement(self) -> String {
        let name = match self {
            Self::Dark => "dark",
            Self::Light => "light",
        };
        format!("window.__THEME__ = '{name}'")
    }
}

/// The palette the app is about to paint in: the stored preference, or the OS
/// where there is none. The capture window is asked about the OS because it is
/// built before any of this and outlives every other window.
fn resolved_theme(app: &tauri::AppHandle) -> ResolvedTheme {
    let stored = app
        .store(SETTINGS_FILE)
        .ok()
        .and_then(|store| store.get(THEME_KEY))
        .and_then(|value| value.as_str().map(str::to_string));

    match stored.as_deref() {
        Some("dark") => ResolvedTheme::Dark,
        Some("light") => ResolvedTheme::Light,
        // `system`, or nothing said yet: whatever the OS is painting.
        _ => {
            let dark = app
                .get_webview_window(CAPTURE_WINDOW)
                .and_then(|window| window.theme().ok())
                .is_some_and(|theme| theme == tauri::Theme::Dark);

            if dark {
                ResolvedTheme::Dark
            } else {
                ResolvedTheme::Light
            }
        }
    }
}

/// Whether the app has ever been told what to do about starting at login. Only
/// the presence of an answer matters here — honouring it is the frontend's job,
/// since that is where the autostart plugin is driven from.
fn has_answered_start_at_login(app: &tauri::AppHandle) -> bool {
    match app.store(SETTINGS_FILE) {
        Ok(store) => store.has(START_AT_LOGIN_KEY),
        Err(error) => {
            // Unreadable settings must not turn into a question asked on every
            // launch, nor into an app that adds itself to the login items.
            log::error!("could not read the settings: {error}");
            true
        }
    }
}

/// The OS's global shortcut table, plus what pressing each Hotkey does.
struct GlobalShortcuts {
    app: tauri::AppHandle,
}

impl hotkey::Registrar for GlobalShortcuts {
    fn register(&self, action: HotkeyAction, hotkey: &str) -> Result<(), String> {
        let handle = self.app.clone();
        self.app
            .global_shortcut()
            .on_shortcut(hotkey, move |_app, _shortcut, event| {
                // Press and release both arrive; one action per press, and only
                // ever the one this combination was registered for.
                if event.state() != ShortcutState::Pressed {
                    return;
                }
                match action {
                    HotkeyAction::Note => start_capture(&handle),
                    HotkeyAction::Task => start_task_creation_window(&handle),
                }
            })
            .map_err(|error| error.to_string())
    }

    fn unregister(&self, hotkey: &str) {
        if let Err(error) = self.app.global_shortcut().unregister(hotkey) {
            log::warn!("could not give up the Hotkey {hotkey}: {error}");
        }
    }
}

/// Registers the two Hotkeys the user last settled on and records the outcomes
/// where the rest of the app can read them. A registration macOS withholds must
/// not take the app down with it: the Tray Menu still reaches both Entry
/// Points, and Settings reports each failure against its own action.
fn register_hotkeys(app: &tauri::AppHandle) {
    settle_stored_hotkeys(app);

    let registrar = GlobalShortcuts { app: app.clone() };
    let hotkeys = hotkey::register_both(
        &stored_hotkey(app, HotkeyAction::Note),
        &stored_hotkey(app, HotkeyAction::Task),
        &registrar,
    );

    for status in [&hotkeys.note, &hotkeys.task] {
        if let hotkey::HotkeyStatus::Unavailable { hotkey, reason } = status {
            log::error!("the Hotkey {hotkey} is unavailable: {reason}");
        }
    }

    app.manage(Mutex::new(hotkeys));
}

/// Writes both combinations down explicitly, once, so that neither is ever
/// again decided by a fallback that could move under the user.
///
/// The Note Hotkey's default changed when the Task Hotkey arrived — the old
/// `Ctrl+Opt+Cmd` family collides with documented VoiceOver commands. Anyone
/// already running the app and relying on the old default keeps it: a settings
/// file that exists but says nothing about the Hotkey belongs to an install
/// that predates this, and the combination it has been using is persisted
/// before the fallback changes beneath it. A settings file with nothing in it
/// at all is a first run, and starts on the new default.
fn settle_stored_hotkeys(app: &tauri::AppHandle) {
    let Ok(store) = app.store(SETTINGS_FILE) else {
        log::error!("could not read the settings; the Hotkeys keep their defaults");
        return;
    };

    let mut written = false;

    if !store.has(HOTKEY_KEY) {
        let existing_install = !store.is_empty();
        let hotkey = if existing_install {
            hotkey::LEGACY_NOTE_HOTKEY
        } else {
            hotkey::DEFAULT_NOTE_HOTKEY
        };
        store.set(HOTKEY_KEY, hotkey);
        written = true;
    }

    if !store.has(TASK_HOTKEY_KEY) {
        store.set(TASK_HOTKEY_KEY, hotkey::DEFAULT_TASK_HOTKEY);
        written = true;
    }

    if written {
        if let Err(error) = store.save() {
            log::error!("could not settle the Hotkeys: {error}");
        }
    }
}

/// The Hotkey as its own Tray Menu item should show it: the combination if it
/// is registered, and nothing at all if it is not.
fn live_hotkey(app: &tauri::AppHandle, action: HotkeyAction) -> Option<String> {
    match app.state::<Mutex<Hotkeys>>().lock().ok()?.of(action) {
        hotkey::HotkeyStatus::Registered { hotkey } => Some(hotkey.clone()),
        hotkey::HotkeyStatus::Unavailable { .. } => None,
    }
}

/// Which key one of the two Hotkeys is remembered under.
fn hotkey_key(action: HotkeyAction) -> &'static str {
    match action {
        HotkeyAction::Note => HOTKEY_KEY,
        HotkeyAction::Task => TASK_HOTKEY_KEY,
    }
}

/// The Hotkey remembered from a previous run, or the one the app ships with.
/// After `settle_stored_hotkeys` the stored value is always there; the fallback
/// remains for a settings file that could not be written.
fn stored_hotkey(app: &tauri::AppHandle, action: HotkeyAction) -> String {
    app.store(SETTINGS_FILE)
        .ok()
        .and_then(|store| store.get(hotkey_key(action)))
        .and_then(|value| value.as_str().map(str::to_string))
        .filter(|hotkey| !hotkey.trim().is_empty())
        .unwrap_or_else(|| {
            match action {
                HotkeyAction::Note => hotkey::DEFAULT_NOTE_HOTKEY,
                HotkeyAction::Task => hotkey::DEFAULT_TASK_HOTKEY,
            }
            .to_string()
        })
}

/// Both Hotkeys' availability, for whichever window asks — Settings reports a
/// failed registration to the user, and points them at the Tray Menu item that
/// does the same thing.
#[tauri::command]
fn hotkey_status(hotkeys: tauri::State<'_, Mutex<Hotkeys>>) -> Result<Hotkeys, String> {
    Ok(hotkeys.lock().map_err(|_| lost_hotkey())?.clone())
}

/// Moves one Hotkey to another combination. A combination the OS refuses — or
/// one the other Hotkey already holds — is reported as an error and is not
/// remembered: restoring it on the next run would leave the app with a Hotkey
/// that does nothing and no explanation.
#[tauri::command]
fn set_hotkey(
    app: tauri::AppHandle,
    hotkeys: tauri::State<'_, Mutex<Hotkeys>>,
    action: HotkeyAction,
    hotkey: String,
) -> Result<Hotkeys, String> {
    let registrar = GlobalShortcuts { app: app.clone() };
    let mut current = hotkeys.lock().map_err(|_| lost_hotkey())?;
    let next = hotkey::remap(&current, action, &hotkey, &registrar)?;

    let store = app.store(SETTINGS_FILE).map_err(|error| error.to_string())?;
    store.set(hotkey_key(action), next.of(action).hotkey());
    store.save().map_err(|error| error.to_string())?;

    *current = next.clone();
    // The Tray Menu spells each Hotkey out beside its own item; a remap that
    // left one showing the old combination would be worse than showing none.
    let moved = next.of(action).hotkey();
    let updated = match action {
        HotkeyAction::Note => app
            .state::<NewNoteMenuItem>()
            .0
            .set_accelerator(Some(moved)),
        HotkeyAction::Task => app
            .state::<NewTaskMenuItem>()
            .0
            .set_accelerator(Some(moved)),
    };
    if let Err(error) = updated {
        log::warn!("the Tray Menu kept the old Hotkey: {error}");
    }

    Ok(next)
}

fn lost_hotkey() -> String {
    "the Hotkey could not be read".to_string()
}

/// Writes the whole journal — Notes and Tasks — to a Markdown file, the way out
/// of the SQLite file. The Markdown is rendered by the journal core; all that
/// is left here is putting it somewhere the user can find it, and saying where
/// that was.
#[tauri::command]
fn export_journal(
    app: tauri::AppHandle,
    markdown: String,
    file_name: String,
) -> Result<ExportedFile, String> {
    let directory = app
        .path()
        .download_dir()
        .map_err(|error| format!("there is nowhere to export to: {error}"))?;

    export::write(&directory, &file_name, &markdown).map_err(|error| error.to_string())
}

/// Puts today's Captured Note count beside the menu bar glyph. What it says is
/// decided in `src/journal/tray-count.ts` and rendered by the journal core —
/// this only carries the text across, because the count lives in the database
/// and the tray lives here.
///
/// A missing tray is not worth failing over: the count is a reminder, and the
/// window that asked for it is in the middle of a Capture.
#[tauri::command]
fn show_tray_count(app: tauri::AppHandle, title: String) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        log::warn!("there is no tray to count on");
        return;
    };

    if let Err(error) = tray.set_title(Some(title)) {
        log::warn!("the tray kept the old count: {error}");
    }
}

/// What the OS allows the app to read of the user's calendars. Asked rather
/// than remembered: a grant can be revoked in System Settings, and a rebuilt
/// binary is one macOS has never seen. Never prompts.
#[tauri::command(async)]
fn calendar_access() -> Access {
    calendar::access()
}

/// Asks the user, through the OS, and answers with what it came to. Off the
/// main thread: the dialog is the system's, and the app must not sit frozen
/// behind it while the user reads it.
#[tauri::command(async)]
fn request_calendar_access() -> Access {
    calendar::request_access()
}

/// Every calendar the user has, for Settings to offer as a tick-list.
#[tauri::command(async)]
fn calendars() -> Vec<CalendarInfo> {
    calendar::calendars()
}

/// Today's events, from every calendar. Which of them are meetings worth
/// keeping is the journal's question, not this side's.
#[tauri::command(async)]
fn todays_calendar_events() -> Vec<CalendarEvent> {
    calendar::todays_events()
}

/// Passes on the one thing the OS says that the webviews cannot hear for
/// themselves: the machine is awake again. A sleeping Mac runs no timers, so
/// without this a sweep that was due at 11:00 simply never happens.
#[cfg(target_os = "macos")]
fn watch_for_wake(app: &tauri::AppHandle) {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};
    use objc2_foundation::NSString;

    let handle = app.clone();
    let observed = block2::RcBlock::new(move |_notification: *mut AnyObject| {
        if let Err(error) = handle.emit(SYSTEM_WOKE_EVENT, ()) {
            log::warn!("could not pass on the wake: {error}");
        }
    });

    unsafe {
        let workspace: Retained<AnyObject> = msg_send![class!(NSWorkspace), sharedWorkspace];
        let center: Retained<AnyObject> = msg_send![&*workspace, notificationCenter];
        let name = NSString::from_str("NSWorkspaceDidWakeNotification");

        let observer: Retained<AnyObject> = msg_send![
            &*center,
            addObserverForName: &*name,
            object: std::ptr::null::<AnyObject>(),
            queue: std::ptr::null::<AnyObject>(),
            usingBlock: block2::RcBlock::as_ptr(&observed),
        ];

        // Both live as long as the app does, and the app only stops when the
        // process does — so they are deliberately never given up.
        std::mem::forget(observer);
        std::mem::forget(observed);
    }
}

/// Ends a Capture, whether it committed a Note or discarded one. The window is
/// only ever hidden — see docs/adr/0002-capture-window-is-hidden-never-closed.md.
#[tauri::command]
fn dismiss_capture(app: tauri::AppHandle) -> Result<(), String> {
    hide_capture_window(&app).map_err(|error| error.to_string())
}

/// A Task Entry Point reached from a webview — the New Task control in Tasks
/// View. The Hotkey and the Tray Menu reach the same place without this.
#[tauri::command]
fn start_task_creation(app: tauri::AppHandle) {
    start_task_creation_window(&app);
}

/// Ends a Task Creation, whether it committed a Task or abandoned one. Hidden
/// rather than closed, for the same reason the capture window is.
#[tauri::command]
fn dismiss_task_creation(app: tauri::AppHandle) -> Result<(), String> {
    hide_task_creation_window(&app).map_err(|error| error.to_string())
}

fn hide_task_creation_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(TASK_CREATION_WINDOW) {
        window.hide()?;
    }

    // Hiding the window leaves this app active, so the user would be left
    // typing into nothing. Hiding the app hands focus back to whatever was in
    // front when the Task Creation began.
    #[cfg(target_os = "macos")]
    app.hide()?;

    Ok(())
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

/// Become active without unhiding windows. Needed before the Tray Menu opens:
/// an Accessory app that has never been active loses the menu to the activation
/// that the click itself triggers.
#[cfg(target_os = "macos")]
fn activate_for_tray_menu() {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    unsafe {
        let app: Retained<AnyObject> = msg_send![class!(NSApplication), sharedApplication];
        let active: bool = msg_send![&*app, isActive];
        if !active {
            let _: bool = msg_send![&*app, activateIgnoringOtherApps: true];
        }
    }
}

/// Asks the capture window for yesterday's Digest. Nothing more happens here:
/// the day, the Notes and the Markdown are all the journal's, and the window
/// puts the result on the clipboard itself.
///
/// A failure is not worth taking the app down for — the clipboard simply keeps
/// what it had, which is the same thing an empty yesterday does.
fn copy_yesterday_digest(app: &tauri::AppHandle) {
    if app.get_webview_window(CAPTURE_WINDOW).is_none() {
        log::warn!("there is no capture window to render yesterday's Digest");
        return;
    }
    // Addressed rather than broadcast: one window answers this, and a second
    // one hearing it would copy the same Digest twice over the first.
    if let Err(error) = app.emit_to(CAPTURE_WINDOW, COPY_YESTERDAY_DIGEST_EVENT, ()) {
        log::warn!("could not ask for yesterday's Digest: {error}");
    }
}

/// The Tray Menu — the Entry Point that always works, and the one Settings
/// points at when the Hotkey cannot be registered. Quit is here because without
/// a Dock icon it is the only way out.
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    // The Hotkey is spelled out next to New Note so the Tray Menu teaches the
    // faster Entry Point. Only when it is actually live: an accelerator beside
    // a combination the OS refused would promise a keystroke that does nothing.
    let new_note = MenuItem::with_id(
        app,
        NEW_NOTE_MENU_ITEM,
        "New Note",
        true,
        live_hotkey(app, HotkeyAction::Note).as_deref(),
    )?;
    // Kept so a remap can move the accelerator with it.
    app.manage(NewNoteMenuItem(new_note.clone()));
    // The other Entry Point, and the fallback Settings points at when the Task
    // Hotkey is the one macOS withheld.
    let new_task = MenuItem::with_id(
        app,
        NEW_TASK_MENU_ITEM,
        "New Task",
        true,
        live_hotkey(app, HotkeyAction::Task).as_deref(),
    )?;
    app.manage(NewTaskMenuItem(new_task.clone()));
    let view_notes =
        MenuItem::with_id(app, VIEW_NOTES_MENU_ITEM, "View Notes", true, None::<&str>)?;
    let view_tasks =
        MenuItem::with_id(app, VIEW_TASKS_MENU_ITEM, "View Tasks", true, None::<&str>)?;
    // The other half of the loop: what was captured yesterday, ready to paste
    // into the work log the user owes their chat group every morning.
    let copy_yesterday = MenuItem::with_id(
        app,
        COPY_YESTERDAY_DIGEST_MENU_ITEM,
        "Copy Yesterday's Digest",
        true,
        None::<&str>,
    )?;
    let settings = MenuItem::with_id(app, SETTINGS_MENU_ITEM, "Settings", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, QUIT_MENU_ITEM, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &new_note,
            &new_task,
            &view_notes,
            &view_tasks,
            &copy_yesterday,
            &settings,
            &separator,
            &quit,
        ],
    )?;

    // tray-icon opens the menu from `mouseDown` via `performClick`. On an
    // Accessory app that has never been active, that same click also activates
    // the app, and the activation cancels the menu ~250ms later — first click
    // after launch flashes open and shut. Open from `mouseUp` after becoming
    // active, so the menu is only shown once activation has finished.
    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            let TrayIconEvent::Click {
                button: MouseButton::Left | MouseButton::Right,
                button_state: MouseButtonState::Up,
                ..
            } = event
            else {
                return;
            };
            #[cfg(target_os = "macos")]
            activate_for_tray_menu();
            let _ = tray.with_inner_tray_icon(|inner| inner.show_menu());
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            NEW_NOTE_MENU_ITEM => start_capture(app),
            NEW_TASK_MENU_ITEM => start_task_creation_window(app),
            VIEW_NOTES_MENU_ITEM => open_history(app),
            VIEW_TASKS_MENU_ITEM => open_tasks(app),
            COPY_YESTERDAY_DIGEST_MENU_ITEM => copy_yesterday_digest(app),
            SETTINGS_MENU_ITEM => open_settings(app),
            QUIT_MENU_ITEM => app.exit(0),
            _ => {}
        });

    // The menu bar wants a flat monochrome glyph, not the app icon: macOS
    // recolours a template image for the light and the dark bar itself, while
    // the rounded app tile would sit up there as a coloured sticker. Falling
    // back to the app icon keeps the tray — the Entry Point that always works —
    // from being lost if the glyph ever fails to decode.
    match tauri::image::Image::from_bytes(TRAY_ICON) {
        Ok(icon) => {
            tray = tray.icon(icon);
            #[cfg(target_os = "macos")]
            {
                tray = tray.icon_as_template(true);
            }
        }
        Err(error) => {
            log::error!("tray glyph failed to decode, using the app icon: {error}");
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
        }
    }

    let tray = tray.build(app)?;
    // tray-icon defaults to opening on right-mouseDown too; same race. Both
    // buttons go through the mouseUp handler above instead.
    let _ = tray.with_inner_tray_icon(|inner| inner.set_show_menu_on_right_click(false));

    Ok(())
}
