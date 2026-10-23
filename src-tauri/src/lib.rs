#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Single-instance must be the first plugin registered (SPEC §10.1).
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_window_state::Builder::default().build());

    builder
        .plugin(tauri_plugin_fs::init())
        // Paths chosen in a save/open dialog are added to the fs scope by the dialog
        // plugin itself (plugins/dialog/src/commands.rs), so the capability only
        // pre-authorizes $APPDATA.
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running Morse Trainer");
}

/// A second launch brings the existing window forward instead of opening another.
#[cfg(desktop)]
fn focus_main_window(app: &tauri::AppHandle) {
    use tauri::Manager;

    let Some(window) = app.get_webview_window("main") else {
        eprintln!("single-instance: main window not found");
        return;
    };
    for (step, result) in [
        ("unminimize", window.unminimize()),
        ("show", window.show()),
        ("set_focus", window.set_focus()),
    ] {
        if let Err(err) = result {
            eprintln!("single-instance: {step} failed: {err}");
        }
    }
}
