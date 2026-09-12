#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![enter_companion, exit_companion])
        .setup(|app| {
            use tauri::Manager;

            println!("ZOYA Desktop Native Engine initialized");

            // Windows' native minimize button is not exposed as a Tauri WindowEvent.
            // Poll the main window's minimized state so the real OS minimize action
            // enters the same desktop-companion flow as the in-app button.
            let app_handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(std::time::Duration::from_millis(150));

                let Some(main) = app_handle.get_webview_window("main") else {
                    break;
                };

                if app_handle.get_webview_window("companion").is_some() {
                    continue;
                }

                match main.is_minimized() {
                    Ok(true) => {
                        if let Err(err) = main.unminimize() {
                            eprintln!("[ZOYA] Failed to restore minimized main window: {err}");
                            continue;
                        }
                        if let Err(err) = enter_companion(app_handle.clone()) {
                            eprintln!("[ZOYA] Failed to enter desktop companion: {err}");
                        }
                    }
                    Ok(false) => {}
                    Err(err) => {
                        eprintln!("[ZOYA] Failed to read main minimized state: {err}");
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running zoya tauri application");
}

#[cfg(target_os = "windows")]
#[repr(C)]
struct WinRect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[cfg(target_os = "windows")]
#[link(name = "user32")]
extern "system" {
    fn FindWindowW(class_name: *const u16, window_name: *const u16) -> *mut std::ffi::c_void;
    fn GetWindowRect(hwnd: *mut std::ffi::c_void, rect: *mut WinRect) -> i32;
}

#[cfg(target_os = "windows")]
fn get_windows_taskbar_rect() -> Option<WinRect> {
    // Shell_TrayWnd is the real Windows taskbar window class. This follows the
    // same native approach as FindWindowW("Shell_TrayWnd", NULL) rather than
    // guessing the taskbar height or assuming it is at the bottom of the screen.
    let class_name: Vec<u16> = "Shell_TrayWnd".encode_utf16().chain(std::iter::once(0)).collect();
    let hwnd = unsafe { FindWindowW(class_name.as_ptr(), std::ptr::null()) };
    if hwnd.is_null() {
        return None;
    }

    let mut rect = WinRect { left: 0, top: 0, right: 0, bottom: 0 };
    let ok = unsafe { GetWindowRect(hwnd, &mut rect) } != 0;
    ok.then_some(rect)
}

#[tauri::command]
fn enter_companion(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

    if let Some(existing) = app.get_webview_window("companion") {
        existing.show().map_err(|e| e.to_string())?;
        existing.set_focus().map_err(|e| e.to_string())?;
    } else {
        let monitor = app
            .primary_monitor()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "No primary monitor available".to_string())?;
        let work_area = monitor.work_area();
        let scale = monitor.scale_factor();
        let width = 330.0_f64;
        let height = 390.0_f64;
        let margin = 2.0_f64;

        // Prefer the actual Windows taskbar rectangle. This handles a taskbar
        // placed on the bottom, top, left, or right without hard-coded offsets.
        // Fall back to Tauri's monitor work area if the Shell_TrayWnd lookup is
        // unavailable (for example, a non-Windows build).
        #[cfg(target_os = "windows")]
        let position = if let Some(taskbar) = get_windows_taskbar_rect() {
            let taskbar_left = taskbar.left as f64 / scale;
            let taskbar_top = taskbar.top as f64 / scale;
            let taskbar_right = taskbar.right as f64 / scale;
            let taskbar_bottom = taskbar.bottom as f64 / scale;

            let work_left = work_area.position.x as f64 / scale;
            let work_top = work_area.position.y as f64 / scale;
            let work_right = (work_area.position.x + work_area.size.width as i32) as f64 / scale;
            let work_bottom = (work_area.position.y + work_area.size.height as i32) as f64 / scale;

            let taskbar_is_horizontal = (taskbar_right - taskbar_left) > (taskbar_bottom - taskbar_top);
            if taskbar_is_horizontal {
                let x = (taskbar_right - width - margin).max(work_left);
                let y = if taskbar_top > work_top {
                    taskbar_top - height - margin
                } else {
                    taskbar_bottom + margin
                };
                (x.min(work_right - width), y.max(work_top))
            } else {
                let x = if taskbar_left > work_left {
                    taskbar_left - width - margin
                } else {
                    taskbar_right + margin
                };
                let y = (taskbar_bottom - height - margin).max(work_top);
                (x.max(work_left), y.min(work_bottom - height))
            }
        } else {
            (
                ((work_area.position.x as f64 + work_area.size.width as f64) / scale - width - margin).max(0.0),
                ((work_area.position.y as f64 + work_area.size.height as f64) / scale - height - margin).max(0.0),
            )
        };

        #[cfg(not(target_os = "windows"))]
        let position = (
            ((work_area.position.x as f64 + work_area.size.width as f64) / scale - width - margin).max(0.0),
            ((work_area.position.y as f64 + work_area.size.height as f64) / scale - height - margin).max(0.0),
        );

        let url = if cfg!(debug_assertions) {
            WebviewUrl::External("http://localhost:3000/?companion=1".parse().expect("valid ZOYA dev URL"))
        } else {
            WebviewUrl::App("index.html?companion=1".into())
        };

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
        main.eval("window.location.reload()").map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}
