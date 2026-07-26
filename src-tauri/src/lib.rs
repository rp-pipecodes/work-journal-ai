use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
};

const QUIT_MENU_ITEM: &str = "quit";

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Registered first, deliberately: a second launch must exit here,
        // before it can build a second tray icon or fail to register the
        // Hotkey. Showing a capture window in the surviving instance is a
        // later ticket's job.
        .plugin(tauri_plugin_single_instance::init(|_app, _args, _cwd| {}))
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::new().build())
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

            build_tray(app.handle())?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// The Tray Menu — the Entry Point that always works. It gains New Note, View
/// Notes and Settings as those arrive; Quit is the one it needs today, because
/// without a Dock icon it is the only way out.
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let quit = MenuItem::with_id(app, QUIT_MENU_ITEM, "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&quit])?;

    let mut tray = TrayIconBuilder::with_id("tray")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            if event.id().as_ref() == QUIT_MENU_ITEM {
                app.exit(0);
            }
        });

    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }

    tray.build(app)?;

    Ok(())
}
