#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![enter_companion, exit_companion])
        .setup(|_app| {
            println!("ZOYA Desktop Native Engine initialized");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running zoya tauri application");
}

#[tauri::command]
fn enter_companion(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::{Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

    if let Some(existing) = app.get_webview_window("companion") {
        existing.show().map_err(|e| e.to_string())?;
        existing.set_focus().map_err(|e| e.to_string())?;
    } else {
        let monitor = app
            .primary_monitor()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "No primary monitor available".to_string())?;
        let screen = monitor.size();
        let scale = monitor.scale_factor();
        let width = 330.0_f64;
        let height = 390.0_f64;
        let margin = 18.0_f64;
        let x = (screen.width as f64 / scale - width - margin).max(0.0);
        let y = (screen.height as f64 / scale - height - margin).max(0.0);

        let url = if cfg!(debug_assertions) {
            WebviewUrl::External("http://localhost:3000/?companion=1".parse().map_err(|e| e.to_string())?)
        } else {
            WebviewUrl::App("index.html?companion=1".into())
        };

        WebviewWindowBuilder::new(&app, "companion", url)
            .title("ZOYA Companion")
            .inner_size(width, height)
            .position(x, y)
            .resizable(false)
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .skip_taskbar(true)
            .shadow(false)
            .visible(true)
            .build()
            .map_err(|e| e.to_string())?;
    }

    if let Some(main) = app.get_webview_window("main") {
        main.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn exit_companion(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;

    if let Some(companion) = app.get_webview_window("companion") {
        companion.close().map_err(|e| e.to_string())?;
    }
    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}
