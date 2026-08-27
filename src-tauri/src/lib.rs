mod alerts;
mod calendar;
mod export;
mod frontmost;
mod hotkey;

use alerts::{Permission, TaskAlert};
use calendar::{Access, CalendarEvent, CalendarInfo};
use export::ExportedFile;
use frontmost::PreviousApplication;
use hotkey::{HotkeyAction, Hotkeys};
use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::Color,
    Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_sql::{DbInstances, DbPool, Migration, MigrationKind};
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
const MAIN_WINDOW: &str = "main";
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

/// The user clicked a Task Alert. macOS hands the click to this side, which is
/// the only part of the app it talks to; Tasks View opens focused on the Task.
/// Must match `TASK_ALERT_OPENED_EVENT` in `src/platform/desktop.ts`.
const TASK_ALERT_OPENED_EVENT: &str = "task-alert://opened";

/// The resting height of each resident window: the panel its view draws, plus
/// the transparent gutter the view's own drop shadow needs on every side. They
/// differ because a Task may say when it is meant to be done and how often it
/// repeats, and a Note may say neither, so the Task Creation panel has two more
/// rows under its field. Must match `CAPTURE_HEIGHT` and
/// `TASK_CREATION_HEIGHT` in `src/platform/desktop.ts`.
const CAPTURE_HEIGHT: f64 = 130.0;
const TASK_CREATION_HEIGHT: f64 = 219.0;

/// Both resident windows are this wide. Must match `CAPTURE_WIDTH` in
/// `src/platform/desktop.ts`.
const RESIDENT_WINDOW_WIDTH: f64 = 626.0;

/// Relative, so plugin-sql resolves it inside the app's data directory and the
/// journal survives a restart of the app and of the machine.
const DATABASE_URL: &str = "sqlite:work-journal.db";

/// The two Entry Point items of the Tray Menu, held so that remapping either
/// Hotkey can update the combination shown beside its own item.
struct NewNoteMenuItem(MenuItem<tauri::Wry>);
struct NewTaskMenuItem(MenuItem<tauri::Wry>);

/// The Task Alert the user clicked, waiting for a window to claim it.
///
/// The event alone is not enough: a click on an Alert delivered while Work
/// Journal was not running arrives before Tasks View has a webview, so nothing
/// is listening and the focus would be dropped — which is precisely the case
/// the Alert exists for. It is kept here instead, and the window asks for it as
/// it opens. Taken rather than read: an Alert opens the window once.
#[derive(Default)]
struct OpenedTaskAlert(Mutex<Option<String>>);

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
            todays_calendar_events,
            opened_task_alert,
            task_alert_permission,
            request_task_alert_permission,
            reconcile_task_alerts,
            open_notification_settings,
            journal_transaction
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
            build_resident_window(app.handle(), CAPTURE_WINDOW, "New Note", CAPTURE_HEIGHT)?;
            build_resident_window(
                app.handle(),
                TASK_CREATION_WINDOW,
                "New Task",
                TASK_CREATION_HEIGHT,
            )?;
            build_tray(app.handle())?;

            // Nothing has been clicked yet, but a click can arrive before any
            // window exists — so somewhere to keep it has to.
            app.manage(OpenedTaskAlert::default());

            // Whoever is in front when a Capture begins, kept so that putting
            // the Capture away can hand focus back to them.
            app.manage(PreviousApplication::default());

            // Told to whichever window is sweeping the calendar. Set up after
            // the capture window, because that is the window that hears it.
            #[cfg(target_os = "macos")]
            watch_for_wake(app.handle());

            // Before launching finishes: a click on a Task Alert that macOS
            // delivered while Work Journal was not running arrives as the app
            // starts, and a delegate set any later would never hear it.
            watch_for_task_alerts(app.handle());

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
        Migration {
            version: 5,
            description: "task schedule",
            sql: include_str!("../migrations/0005_task_schedule.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "task recurrence",
            sql: include_str!("../migrations/0006_task_recurrence.sql"),
            kind: MigrationKind::Up,
        },
    ]
}

/// The two resident windows: built once at startup, thereafter only shown and
/// hidden — see docs/adr/0002-capture-window-is-hidden-never-closed.md. They
/// are two windows rather than two modes of one so that an unfinished Capture
/// and an unfinished Task Creation can both be waiting at once; see
/// docs/adr/0019-task-creation-has-its-own-resident-window.md.
///
/// Both are nearly the same shape, so they are built by the same function: the
/// panel the user sees is smaller than the window on every side, because the
/// view draws the panel's own drop shadow and a window sized to the panel would
/// clip it. They differ only in how tall they rest, which is why the height is
/// passed in. Must match `CAPTURE_WIDTH` and the resting heights in
/// `src/platform/desktop.ts`.
fn build_resident_window(
    app: &tauri::AppHandle,
    label: &str,
    title: &str,
    height: f64,
) -> tauri::Result<()> {
    WebviewWindowBuilder::new(app, label, WebviewUrl::default())
        .title(title)
        .inner_size(RESIDENT_WINDOW_WIDTH, height)
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

/// What every Note Entry Point does. Each of them reaches the same single
/// place, and none can fail loudly enough to be worth more than a log: the user
/// asked for a Capture, not for an error.
fn start_capture(app: &tauri::AppHandle) {
    show_resident_window(app, CAPTURE_WINDOW, CAPTURE_SHOWN_EVENT)
}

/// What every Task Entry Point does — the Task Hotkey, New Task in the Tray
/// Menu, and the New Task control in Tasks View all arrive here.
fn start_task_creation_window(app: &tauri::AppHandle) {
    show_resident_window(app, TASK_CREATION_WINDOW, TASK_CREATION_SHOWN_EVENT)
}

fn show_resident_window(app: &tauri::AppHandle, label: &str, shown_event: &str) {
    if let Err(error) = raise_resident_window(app, label, shown_event) {
        log::error!("could not show the {label} window: {error}");
    }
}

/// The window is already alive, so showing it is all that is left. Focus is
/// requested explicitly because a Dock-less app does not reliably receive it
/// when a window becomes visible.
///
/// The other resident window is put away first, and put away by this side
/// rather than by asking it to dismiss itself: the two panels float over
/// everything, so both on screen at once is one too many — but whatever is
/// half-typed in the one going away has to survive, which a dismiss would
/// discard.
fn raise_resident_window(
    app: &tauri::AppHandle,
    label: &str,
    shown_event: &str,
) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window(label) else {
        log::error!("the {label} window is missing");
        return Ok(());
    };

    // An Entry Point reached while its own window is already up focuses it and
    // changes nothing else: showing again would clear a line the user is
    // halfway through typing.
    if window.is_visible()? {
        return window.set_focus();
    }

    // Whoever the panel is about to float over, remembered before anything
    // moves: dismissing it hands focus straight back to them, and hiding the
    // other panel first would let macOS promote somebody else in the meantime.
    remember_frontmost_application(app);

    if let Some(other) = app.get_webview_window(other_resident_window(label)) {
        other.hide()?;
    }

    window.show()?;
    window.set_focus()?;
    window.emit(shown_event, ())?;

    Ok(())
}

/// The resident window that is not this one. There are exactly two.
fn other_resident_window(label: &str) -> &'static str {
    if label == CAPTURE_WINDOW {
        TASK_CREATION_WINDOW
    } else {
        CAPTURE_WINDOW
    }
}

/// Opens the Main Window, building it if it is not already open. Unlike the
/// capture window this one is created on demand and genuinely closed on
/// dismiss — see docs/adr/0002-capture-window-is-hidden-never-closed.md and
/// docs/adr/0022-one-main-window-for-reading-and-settings.md.
fn open_main_window(app: &tauri::AppHandle) {
    if let Err(error) = show_main_window(app) {
        log::error!("could not open the Main Window: {error}");
    }
}

/// One size for the whole window, whichever section is showing: the sidebar's
/// width on top of the room History had when it was a window of its own — see
/// `SectionSidebar` in `src/views/main/SectionSidebar.tsx`. A window that
/// resized itself when the user clicked a sidebar item would be disorienting,
/// and would have nothing to say about a window already resized by hand.
fn show_main_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    show_on_demand_window(
        app,
        MAIN_WINDOW,
        "Work Journal",
        (696.0, 620.0),
        (556.0, 320.0),
    )
}

/// A window built the first time it is asked for and raised every time after,
/// until it is dismissed and genuinely closed. The windows that work this way
/// — the Main Window, Tasks View and Settings — differ only in their label,
/// their title and their size; the awkward parts are the same for all of them,
/// so they are only written once.
fn show_on_demand_window(
    app: &tauri::AppHandle,
    label: &str,
    title: &str,
    size: (f64, f64),
    min_size: (f64, f64),
) -> tauri::Result<()> {
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
/// demand and genuinely closed on dismiss, like the Main Window.
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

/// Writes both combinations down explicitly, once. What each should be is
/// `hotkey::settle`'s decision; all that happens here is reading the settings
/// file, telling it whether this installation predates Tasks, and saving.
fn settle_stored_hotkeys(app: &tauri::AppHandle) {
    let Ok(store) = app.store(SETTINGS_FILE) else {
        log::error!("could not read the settings; the Hotkeys keep their defaults");
        return;
    };

    let stored_note = store.get(HOTKEY_KEY);
    let stored_task = store.get(TASK_HOTKEY_KEY);
    let (note, task) = hotkey::settle(
        stored_note.as_ref().and_then(|value| value.as_str()),
        stored_task.as_ref().and_then(|value| value.as_str()),
        // A settings file with anything in it, or a journal already on disk:
        // either is an installation that was running before Tasks existed.
        !store.is_empty() || journal_database_exists(app),
    );

    if let Some(note) = note {
        store.set(HOTKEY_KEY, note);
    }
    if let Some(task) = task {
        store.set(TASK_HOTKEY_KEY, task);
    }

    if note.is_some() || task.is_some() {
        if let Err(error) = store.save() {
            log::error!("could not settle the Hotkeys: {error}");
        }
    }
}

/// Whether this machine already holds a journal — the evidence that the app has
/// been run before, and the one that survives a settings file that never got
/// written. Both directories are looked in because that is where plugin-sql
/// resolves a relative database URL to.
fn journal_database_exists(app: &tauri::AppHandle) -> bool {
    let file = DATABASE_URL.trim_start_matches("sqlite:");

    [app.path().app_config_dir(), app.path().app_data_dir()]
        .into_iter()
        .flatten()
        .any(|directory| directory.join(file).exists())
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

/// What the OS allows the app to deliver as Task Alerts. Asked rather than
/// remembered: a grant is revoked in System Settings without the app hearing of
/// it. Never prompts.
#[tauri::command(async)]
fn task_alert_permission() -> Permission {
    alerts::permission()
}

/// Asks the user, through the OS, and answers with what it came to. Off the
/// main thread: the dialog is the system's, and the app must not sit frozen
/// behind it while the user reads it.
#[tauri::command(async)]
fn request_task_alert_permission() -> Permission {
    alerts::request_permission()
}

/// Makes the OS's pending requests say exactly what the journal says. A failure
/// is reported back and goes no further: the Task it was about is already
/// stored, and a Task Alert is derived from it — see
/// docs/adr/0017-the-os-schedules-task-alerts.md.
#[tauri::command(async)]
fn reconcile_task_alerts(alerts: Vec<TaskAlert>) -> Result<(), String> {
    alerts::reconcile(&alerts)
}

/// Opens System Settings at Notifications. The only way back after a denial,
/// because macOS never shows its own prompt a second time.
#[tauri::command(async)]
fn open_notification_settings() -> Result<(), String> {
    alerts::open_settings()
}

/// Listens for clicks on Task Alerts, and turns each one into an open Tasks
/// View focused on that Task. The identifier is passed through untouched: which
/// Task it names is the journal's to say, in `taskIdOfAlert`.
fn watch_for_task_alerts(app: &tauri::AppHandle) {
    let handle = app.clone();

    alerts::watch_for_clicks(alerts::Clicks {
        opened: Box::new(move |identifier| {
            // Written down first, and always: a Tasks View built by this very
            // click has no webview yet and would never hear the event, so it
            // asks for this as it opens instead.
            if let Some(pending) = handle.try_state::<OpenedTaskAlert>() {
                if let Ok(mut waiting) = pending.0.lock() {
                    *waiting = Some(identifier.clone());
                }
            }

            open_tasks(&handle);

            // And announced too, for the window that was already open and has
            // long since asked. Addressed rather than broadcast: only Tasks
            // View has anything to do with it.
            if let Err(error) = handle.emit_to(
                TASKS_WINDOW,
                TASK_ALERT_OPENED_EVENT,
                TaskAlertOpened {
                    task_id: identifier,
                },
            ) {
                log::warn!("could not pass on the Task Alert: {error}");
            }
        }),
    });
}

/// The Task Alert that opened this window, if one did — asked for by Tasks View
/// as it opens. Taken rather than read: an Alert singles a Task out once, and a
/// window opened for any other reason must not inherit the last click.
#[tauri::command]
fn opened_task_alert(pending: tauri::State<'_, OpenedTaskAlert>) -> Option<String> {
    pending.0.lock().ok()?.take()
}

/// Which Task an Alert the user clicked was about. Must match the payload
/// `onTaskAlertOpened` reads in `src/platform/tauri-desktop.ts`.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct TaskAlertOpened {
    task_id: String,
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

/// One statement of a transaction, exactly as the journal's storage seam hands
/// it over. Must match `SqlStatement` in `src/journal/journal.ts`.
#[derive(serde::Deserialize)]
struct Statement {
    sql: String,
    params: Vec<serde_json::Value>,
}

/// Every statement, or none — the journal's transaction seam; see
/// docs/adr/0020-recurring-task-transitions-are-transactional.md.
///
/// It is here rather than in the webview because `tauri-plugin-sql` hands each
/// call whichever connection of its pool happens to be free, so a `BEGIN` sent
/// from JavaScript would not be on the same connection as the writes that
/// follow it. This runs the whole list through one `sqlx` transaction on one
/// connection, which is the only way the one-Open-occurrence invariant can
/// survive an interruption.
///
/// The pool is the plugin's own, so these statements see exactly the database
/// the ordinary reads and writes do — there is no second connection to the file
/// and no second copy of the migrations.
#[tauri::command]
async fn journal_transaction(
    databases: tauri::State<'_, DbInstances>,
    statements: Vec<Statement>,
) -> Result<(), String> {
    let databases = databases.0.read().await;
    // The plugin keeps its pools behind an enum whose accessors are not
    // published, so the variant is matched directly.
    #[allow(unreachable_patterns)]
    let pool = match databases
        .get(DATABASE_URL)
        .ok_or_else(|| "the journal database is not open".to_string())?
    {
        DbPool::Sqlite(pool) => pool,
        _ => return Err("the journal database is not SQLite".to_string()),
    };

    let mut transaction = pool.begin().await.map_err(|error| error.to_string())?;

    for statement in statements {
        let mut query = sqlx::query(&statement.sql);
        for value in statement.params {
            // The only three shapes the journal ever stores. Anything else is
            // a statement built wrong, and refusing it loudly is better than
            // stringifying it into a column that will read back as nonsense.
            query = match value {
                serde_json::Value::Null => query.bind(None::<String>),
                serde_json::Value::String(text) => query.bind(text),
                serde_json::Value::Number(number) => query.bind(
                    number
                        .as_i64()
                        .ok_or_else(|| format!("not a whole number: {number}"))?,
                ),
                other => return Err(format!("the journal does not store {other}")),
            };
        }

        // The first refusal ends the transaction: dropping it without a commit
        // rolls back everything before it.
        query
            .execute(&mut *transaction)
            .await
            .map_err(|error| error.to_string())?;
    }

    transaction
        .commit()
        .await
        .map_err(|error| error.to_string())
}

/// Ends a Capture, whether it committed a Note or discarded one. The window is
/// only ever hidden — see docs/adr/0002-capture-window-is-hidden-never-closed.md.
#[tauri::command]
fn dismiss_capture(app: tauri::AppHandle) -> Result<(), String> {
    hide_resident_window(&app, CAPTURE_WINDOW).map_err(|error| error.to_string())
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
    hide_resident_window(&app, TASK_CREATION_WINDOW).map_err(|error| error.to_string())
}

/// Puts a resident window away, whether it committed anything or not. Only
/// ever hidden — see docs/adr/0002-capture-window-is-hidden-never-closed.md.
fn hide_resident_window(app: &tauri::AppHandle, label: &str) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(label) {
        window.hide()?;
    }

    // Hiding the window leaves this app active, so the user would be left
    // typing into nothing. Focus goes back to whatever was in front when the
    // Capture or Task Creation began — the panel interrupted them, and putting
    // it away is what gives that back. Every other Work Journal window is left
    // exactly as it was, on screen and unfocused.
    hand_focus_back(app);

    Ok(())
}

/// Takes note of the application a resident panel is about to cover, so that
/// dismissing the panel can hand focus back to it.
fn remember_frontmost_application(app: &tauri::AppHandle) {
    app.state::<PreviousApplication>().note(
        frontmost::frontmost_process_id(),
        frontmost::own_process_id(),
    );
}

/// Hands focus back to the application a resident panel covered. Nothing to
/// hand it to — nothing was ever in front — leaves focus where it is.
fn hand_focus_back(app: &tauri::AppHandle) {
    if let Some(previous) = app.state::<PreviousApplication>().remembered_id() {
        frontmost::activate(previous);
    }
}

/// Become active without unhiding windows. Needed before the Tray Menu opens:
/// an Accessory app that has never been active loses the menu to the activation
/// that the click itself triggers.
#[cfg(target_os = "macos")]
fn activate_for_tray_menu(app: &tauri::AppHandle) {
    use objc2::rc::Retained;
    use objc2::runtime::AnyObject;
    use objc2::{class, msg_send};

    // The click is about to make this app frontmost, so whoever is in front now
    // is the one a Capture started from the menu will be covering.
    remember_frontmost_application(app);

    unsafe {
        let shared: Retained<AnyObject> = msg_send![class!(NSApplication), sharedApplication];
        let active: bool = msg_send![&*shared, isActive];
        if !active {
            let _: bool = msg_send![&*shared, activateIgnoringOtherApps: true];
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
            activate_for_tray_menu(tray.app_handle());
            let _ = tray.with_inner_tray_icon(|inner| inner.show_menu());
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            NEW_NOTE_MENU_ITEM => start_capture(app),
            NEW_TASK_MENU_ITEM => start_task_creation_window(app),
            VIEW_NOTES_MENU_ITEM => open_main_window(app),
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
