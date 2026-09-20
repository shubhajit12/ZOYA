mod companion_engine;
mod companion_tracker;
mod mate_handoff;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![diagnostic_ping, start_mate_companion, exit_mate_companion, enter_companion, exit_companion, start_companion_drag, finish_companion_drag, start_window_drag, minimize_window, toggle_maximize_window, close_window, set_always_on_top])
        .setup(|app| {
            let startup_lines = [
                "=== ZOYA startup ===".to_string(),
                "version=1.0.0".to_string(),
                "build=mate-handoff-rebuild-2026-09-20-v1".to_string(),
                format!("pid={}", std::process::id()),
                format!("exe={}", std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_else(|_| "<unknown>".to_string())),
            ];
            let startup_text = format!("{}\n", startup_lines.join("\n"));
            let temp_startup_log = std::env::temp_dir().join("ZOYA-startup.log");
            let _ = std::fs::OpenOptions::new().create(true).append(true).open(&temp_startup_log)
                .and_then(|mut file| {
                    use std::io::Write;
                    file.write_all(startup_text.as_bytes())
                });
            if let Ok(app_data) = app.path().app_data_dir() {
                let _ = std::fs::create_dir_all(&app_data);
                let app_startup_log = app_data.join("ZOYA-startup.log");
                let _ = std::fs::OpenOptions::new().create(true).append(true).open(&app_startup_log)
                    .and_then(|mut file| {
                        use std::io::Write;
                        file.write_all(startup_text.as_bytes())
                    });
            }
            println!("ZOYA Desktop Native Engine initialized");
            let engine_running = companion_engine::start(app.handle());
            if !engine_running {
                println!("[ZOYA] C# companion engine unavailable; retaining Rust fallback tracker");
                companion_tracker::start_tracking(app.handle().clone());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn diagnostic_ping(app: tauri::AppHandle) -> Result<(), String> {
    write_companion_diagnostic(&app, "DIAGNOSTIC PING RECEIVED");
    Ok(())
}

#[tauri::command]
fn start_window_drag(app: tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or_else(|| "Main window is not available".to_string())?;
    window.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
fn minimize_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or_else(|| "Main window is not available".to_string())?;
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn toggle_maximize_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or_else(|| "Main window is not available".to_string())?;
    if window.is_maximized().map_err(|e| e.to_string())? {\n        window.unmaximize().map_err(|e| e.to_string())\n    } else {\n        window.maximize().map_err(|e| e.to_string())\n    }
}

#[tauri::command]
fn close_window(app: tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or_else(|| "Main window is not available".to_string())?;
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn set_always_on_top(app: tauri::AppHandle, always_on_top: bool) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or_else(|| "Main window is not available".to_string())?;
    window.set_always_on_top(always_on_top).map_err(|e| e.to_string())
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct WinRect { left: i32, top: i32, right: i32, bottom: i32 }

#[cfg(target_os = "windows")]
#[link(name = "user32")]
extern "system" {
    fn FindWindowW(class_name: *const u16, window_name: *const u16) -> *mut std::ffi::c_void;
    fn GetWindowRect(hwnd: *mut std::ffi::c_void, rect: *mut WinRect) -> i32;
}

#[cfg(target_os = "windows")]
fn get_windows_taskbar_rect() -> Option<WinRect> {
    let class_name: Vec<u16> = "Shell_TrayWnd".encode_utf16().chain(std::iter::once(0)).collect();
    let hwnd = unsafe { FindWindowW(class_name.as_ptr(), std::ptr::null()) };
    if hwnd.is_null() { return None; }
    let mut rect = WinRect { left: 0, top: 0, right: 0, bottom: 0 };
    let ok = unsafe { GetWindowRect(hwnd, &mut rect) } != 0;
    ok.then_some(rect)
}

#[cfg(target_os = "windows")]
fn place_companion_on_taskbar_at(companion: &tauri::WebviewWindow, cursor_x: i32, cursor_y: i32, anchor_x: i32, anchor_y: i32) -> Result<(), String> {
    let taskbar = get_windows_taskbar_rect().ok_or_else(|| "Windows taskbar could not be located".to_string())?;
    let size = companion.outer_size().map_err(|e| e.to_string())?;
    let width = size.width as i32;
    let height = size.height as i32;
    let taskbar_width = taskbar.right - taskbar.left;
    let taskbar_height = taskbar.bottom - taskbar.top;
    let (x, y) = if taskbar_width >= taskbar_height {
        let screen_height = unsafe { extern "system" { fn GetSystemMetrics(index: i32) -> i32; } GetSystemMetrics(1) };
        let x = (cursor_x - anchor_x).clamp(taskbar.left, taskbar.right - width);
        if taskbar.bottom >= screen_height - 2 { (x, taskbar.top - anchor_y) } else { (x, taskbar.bottom - anchor_y) }
    } else {
        let screen_width = unsafe { extern "system" { fn GetSystemMetrics(index: i32) -> i32; } GetSystemMetrics(0) };
        let y = (cursor_y - anchor_y).clamp(taskbar.top, taskbar.bottom - height);
        if taskbar.right >= screen_width - 2 { (taskbar.left - anchor_x, y) } else { (taskbar.right - anchor_x, y) }
    };
    companion.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(x, y))).map_err(|e| e.to_string())
}

#[cfg(not(target_os = "windows"))]
fn place_companion_on_taskbar_at(_companion: &tauri::WebviewWindow, _cursor_x: i32, _cursor_y: i32, _anchor_x: i32, _anchor_y: i32) -> Result<(), String> {
    Err("Taskbar fallback is only available on Windows".to_string())
}

fn write_companion_diagnostic(app: &tauri::AppHandle, message: &str) {
    use std::io::Write;
    let line = format!("{message}\n");
    let temp_path = std::env::temp_dir().join("ZOYA-companion-diagnostic.log");
    let _ = std::fs::OpenOptions::new().create(true).append(true).open(&temp_path)
        .and_then(|mut file| file.write_all(line.as_bytes()));
    if let Ok(app_data) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&app_data);
        let _ = std::fs::OpenOptions::new().create(true).append(true).open(app_data.join("ZOYA-companion-diagnostic.log"))
            .and_then(|mut file| file.write_all(line.as_bytes()));
    }
}

#[tauri::command]
fn start_mate_companion(app: tauri::AppHandle) -> Result<(), String> {
    write_companion_diagnostic(&app, "MINIMIZE COMMAND RECEIVED");
    write_companion_diagnostic(&app, "TAURI COMMAND ENTERED");
    let result = mate_handoff::start(app.clone());
    match &result {
        Ok(()) => write_companion_diagnostic(&app, "MATE HANDOFF RETURNED OK"),
        Err(error) => write_companion_diagnostic(&app, &format!("MATE HANDOFF RETURNED ERROR: {error}")),
    }
    result
}

#[tauri::command]
fn exit_mate_companion(app: tauri::AppHandle) -> Result<(), String> {
    mate_handoff::stop(&app)
}

#[tauri::command]
fn enter_companion(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
    companion_engine::clear();
    companion_tracker::clear_target();
    if let Some(existing) = app.get_webview_window("companion") {
        existing.show().map_err(|e| e.to_string())?;
        existing.set_focus().map_err(|e| e.to_string())?;
    } else {
        let monitor = app.primary_monitor().map_err(|e| e.to_string())?.ok_or_else(|| "No primary monitor available".to_string())?;
        let work_area = monitor.work_area();
        let scale = monitor.scale_factor();
        let width = 330.0_f64;
        let height = 390.0_f64;
        let margin = 2.0_f64;
        #[cfg(target_os = "windows")]
        let taskbar_edge = get_windows_taskbar_rect().map(|taskbar| {
            let work_left = work_area.position.x;
            let work_top = work_area.position.y;
            let work_right = work_area.position.x + work_area.size.width as i32;
            let work_bottom = work_area.position.y + work_area.size.height as i32;
            if taskbar.top >= work_bottom { "bottom" } else if taskbar.bottom <= work_top { "top" } else if taskbar.left >= work_right { "right" } else if taskbar.right <= work_left { "left" } else { "bottom" }
        }).unwrap_or("bottom");
        #[cfg(target_os = "windows")]
        let position = {
            let work_left = work_area.position.x as f64 / scale;
            let work_top = work_area.position.y as f64 / scale;
            let work_right = (work_area.position.x as f64 + work_area.size.width as f64) / scale;
            let work_bottom = (work_area.position.y as f64 + work_area.size.height as f64) / scale;
            match taskbar_edge {
                "top" => ((work_right - width - margin).max(work_left), work_top + margin),
                "left" => (work_left + margin, (work_bottom - height - margin).max(work_top)),
                "right" => ((work_right - width - margin).max(work_left), (work_bottom - height - margin).max(work_top)),
                _ => ((work_right - width - margin).max(work_left), (work_bottom - height - margin).max(work_top)),
            }
        };
        #[cfg(not(target_os = "windows"))]
        let position = (0.0, 0.0);
        let url = if cfg!(debug_assertions) { WebviewUrl::External("http://localhost:3000/?companion=1".parse().expect("valid ZOYA dev URL")) } else { WebviewUrl::App("index.html?companion=1".into()) };
        WebviewWindowBuilder::new(&app, "companion", url)
            .title("ZOYA Companion")
            .inner_size(width, height)
            .position(position.0, position.1)
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
    if let Some(main) = app.get_webview_window("main") { main.hide().map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
fn start_companion_drag(app: tauri::AppHandle, anchor_x: i32, anchor_y: i32) -> Result<(), String> {
    use tauri::Manager;
    let companion = app.get_webview_window("companion").ok_or_else(|| "Companion window is not available".to_string())?;
    let companion_hwnd = companion.hwnd().map_err(|e| e.to_string())?.0 as isize;
    companion_engine::clear();
    companion_tracker::clear_target();
    if companion_engine::is_running() {
        if companion_engine::start_drag(companion_hwnd, anchor_x, anchor_y) { return Ok(()); }
        return Err("C# companion engine could not start native drag".to_string());
    }
    companion.start_dragging().map_err(|e| e.to_string())
}

#[tauri::command]
fn finish_companion_drag(app: tauri::AppHandle, anchor_x: i32, anchor_y: i32) -> Result<bool, String> {
    use tauri::Manager;
    let companion = app.get_webview_window("companion").ok_or_else(|| "Companion window is not available".to_string())?;
    let companion_hwnd = companion.hwnd().map_err(|e| e.to_string())?.0 as isize;
    let (target, cursor_x, cursor_y) = if companion_engine::is_running() {
        let result = companion_engine::finish_drag(anchor_x, anchor_y).ok_or_else(|| "C# companion engine did not return a drag result".to_string())?;
        (result.target, result.cursor_x, result.cursor_y)
    } else {
        let target = companion_tracker::target_under_cursor(companion_hwnd);
        (target, 0, 0)
    };
    let Some(target) = target else {
        companion_engine::clear();
        companion_tracker::clear_target();
        place_companion_on_taskbar_at(&companion, cursor_x, cursor_y, anchor_x, anchor_y)?;
        println!("[ZOYA] Desktop drop -> feet anchor landing");
        return Ok(false);
    };
    companion_tracker::set_target(Some(target.hwnd));
    println!("[ZOYA] Companion bound to HWND={} engine={}", target.hwnd, companion_engine::is_running());
    Ok(true)
}

#[tauri::command]
fn exit_companion(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    companion_engine::clear();
    companion_tracker::clear_target();
    if let Some(companion) = app.get_webview_window("companion") { companion.close().map_err(|e| e.to_string())?; }
    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|e| e.to_string())?;
        main.eval("window.location.reload()").map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}
