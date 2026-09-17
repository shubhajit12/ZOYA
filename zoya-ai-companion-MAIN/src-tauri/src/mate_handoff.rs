use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tauri::Manager;

static MATE_PROCESS: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

fn process_slot() -> &'static Mutex<Option<Child>> {
    MATE_PROCESS.get_or_init(|| Mutex::new(None))
}

fn candidate_paths<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(resource_dir) = app.path().resource_dir() {
        paths.push(resource_dir.join("mate-companion").join("MateEngineX.exe"));
        paths.push(resource_dir.join("MateEngineX.exe"));
    }
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(parent) = current_exe.parent() {
            paths.push(parent.join("mate-companion").join("MateEngineX.exe"));
            paths.push(parent.join("MateEngineX.exe"));
        }
    }
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        paths.push(PathBuf::from(local_app_data).join("Zoya").join("mate-companion").join("MateEngineX.exe"));
    }
    paths
}

fn find_mate_executable<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<PathBuf> {
    candidate_paths(app).into_iter().find(|path| path.is_file())
}

fn find_carlotta<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let resource_dir = app.path().resource_dir().map_err(|err| err.to_string())?;
    let path = resource_dir.join("mate-companion").join("Carlotta.vrm");
    if path.is_file() { Ok(path) } else { Err(format!("Carlotta.vrm was not found at {}", path.display())) }
}

fn write_carlotta_settings<R: tauri::Runtime>(app: &tauri::AppHandle<R>, carlotta: &PathBuf) -> Result<PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|err| err.to_string())?;
    let handoff_dir = app_data.join("mate-companion");
    fs::create_dir_all(&handoff_dir).map_err(|err| format!("Failed to create Mate handoff directory: {err}"))?;
    let settings_path = handoff_dir.join("zoya-settings.json");
    let json = serde_json::json!({
        "selectedModelPath": carlotta.to_string_lossy().to_string(),
        "isTopmost": true,
        "enableWindowSitting": true,
        "enableRandomAvatar": false,
        "enableLocomotion": false,
        "settingsVersion": 1
    });
    fs::write(&settings_path, serde_json::to_vec_pretty(&json).map_err(|err| err.to_string())?)
        .map_err(|err| format!("Failed to prepare Mate settings: {err}"))?;
    Ok(settings_path)
}

pub fn start<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    {
        let mut slot = process_slot().lock().map_err(|_| "Mate process state is unavailable".to_string())?;
        if let Some(child) = slot.as_mut() {
            match child.try_wait() {
                Ok(None) => return Ok(()),
                Ok(Some(_)) | Err(_) => *slot = None,
            }
        }
    }

    let exe = find_mate_executable(&app).ok_or_else(|| "MateEngineX.exe was not found. This build does not contain the Mate companion runtime.".to_string())?;
    let carlotta = find_carlotta(&app)?;
    let settings = write_carlotta_settings(&app, &carlotta)?;

    println!("[ZOYA] Starting Mate companion: {}", exe.display());
    println!("[ZOYA] Mate avatar: {}", carlotta.display());

    let working_dir = exe.parent().map(PathBuf::from);
    let mut command = Command::new(&exe);
    if let Some(dir) = working_dir { command.current_dir(dir); }
    command.arg("--savefile").arg(&settings);

    let child = command.spawn().map_err(|err| format!("Failed to start MateEngineX.exe: {err}"))?;
    {
        let mut slot = process_slot().lock().map_err(|_| "Mate process state is unavailable".to_string())?;
        *slot = Some(child);
    }

    if let Some(main) = app.get_webview_window("main") {
        if let Err(err) = main.hide() {
            let _ = stop(&app);
            return Err(format!("Mate started but ZOYA could not hide its main window: {err}"));
        }
    }

    let monitor_handle = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(250));
        let finished = match process_slot().lock() {
            Ok(mut slot) => match slot.as_mut() {
                Some(child) => match child.try_wait() {
                    Ok(Some(status)) => { println!("[ZOYA] Mate companion exited: {status}"); *slot = None; true }
                    Ok(None) => false,
                    Err(err) => { eprintln!("[ZOYA] Mate process check failed: {err}"); *slot = None; true }
                },
                None => true,
            },
            Err(_) => true,
        };
        if finished {
            if let Some(main) = monitor_handle.get_webview_window("main") { let _ = main.show(); let _ = main.set_focus(); }
            break;
        }
    });
    Ok(())
}

pub fn stop<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    if let Ok(mut slot) = process_slot().lock() {
        if let Some(child) = slot.as_mut() { let _ = child.kill(); let _ = child.wait(); }
        *slot = None;
    }
    if let Some(main) = app.get_webview_window("main") { main.show().map_err(|err| err.to_string())?; main.set_focus().map_err(|err| err.to_string())?; }
    Ok(())
}
