use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};

use tauri::Manager;

static MATE_PROCESS: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

fn process_slot() -> &'static Mutex<Option<Child>> {
    MATE_PROCESS.get_or_init(|| Mutex::new(None))
}

fn handoff_log_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> PathBuf {
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(install_root) = current_exe.parent() {
            if fs::create_dir_all(install_root).is_ok() {
                return install_root.to_path_buf();
            }
        }
    }
    app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir()).join("mate-companion")
}

fn log_line<R: tauri::Runtime>(app: &tauri::AppHandle<R>, message: &str) {
    println!("[ZOYA Mate] {message}");
    let dir = handoff_log_dir(app);
    if fs::create_dir_all(&dir).is_ok() {
        let path = dir.join("mate-handoff.log");
        let line = format!("{message}\n");
        use std::io::Write;
        if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = file.write_all(line.as_bytes());
        }
    }
}

fn recursive_find_exe(root: &Path) -> Option<PathBuf> {
    let entries = fs::read_dir(root).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file()
            && path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.eq_ignore_ascii_case("MateEngineX.exe"))
        {
            return Some(path);
        }
        if path.is_dir() {
            if let Some(found) = recursive_find_exe(&path) {
                return Some(found);
            }
        }
    }
    None
}

fn candidate_paths<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(root) = current_exe.parent() {
            paths.push(root.join("mate-companion").join("MateEngineX.exe"));
            paths.push(root.join("mate-companion").join("bin").join("MateEngineX.exe"));
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        paths.push(resource_dir.join("mate-companion").join("MateEngineX.exe"));
        paths.push(resource_dir.join("mate-companion").join("bin").join("MateEngineX.exe"));
        paths.push(resource_dir.join("MateEngineX.exe"));
        if let Some(found) = recursive_find_exe(&resource_dir) {
            paths.push(found);
        }
    }
    paths
}

fn find_mate_executable<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<PathBuf> {
    candidate_paths(app).into_iter().find(|path| path.is_file())
}

fn find_carlotta<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(root) = current_exe.parent() {
            candidates.push(root.join("mate-companion").join("Carlotta.vrm"));
            candidates.push(root.join("mate-companion").join("bin").join("Carlotta.vrm"));
        }
    }
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("mate-companion").join("Carlotta.vrm"));
        candidates.push(resource_dir.join("mate-companion").join("bin").join("Carlotta.vrm"));
    }
    candidates.into_iter().find(|path| path.is_file())
        .ok_or_else(|| "Carlotta.vrm was not found in the packaged Mate companion resources".to_string())
}

fn write_carlotta_settings<R: tauri::Runtime>(app: &tauri::AppHandle<R>, carlotta: &Path) -> Result<PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dir = app_data.join("mate-companion");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create Mate settings directory: {e}"))?;
    let path = dir.join("zoya-settings.json");
    let json = serde_json::json!({
        "selectedModelPath": carlotta.to_string_lossy().to_string(),
        "isTopmost": true,
        "enableWindowSitting": true,
        "enableRandomAvatar": false,
        "enableLocomotion": false,
        "settingsVersion": 1
    });
    fs::write(&path, serde_json::to_vec_pretty(&json).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Failed to write Mate settings: {e}"))?;
    Ok(path)
}

pub fn start<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    log_line(&app, "=== Mate handoff started ===");

    let exe = match find_mate_executable(&app) {
        Some(path) => path,
        None => {
            let message = format!("MateEngineX.exe not found. Checked: {:?}", candidate_paths(&app));
            log_line(&app, &message);
            return Err(message);
        }
    };
    log_line(&app, &format!("Mate executable: {}", exe.display()));

    let carlotta = match find_carlotta(&app) {
        Ok(path) => path,
        Err(err) => {
            log_line(&app, &err);
            return Err(err);
        }
    };
    log_line(&app, &format!("Carlotta: {}", carlotta.display()));

    let settings = match write_carlotta_settings(&app, &carlotta) {
        Ok(path) => path,
        Err(err) => {
            log_line(&app, &err);
            return Err(err);
        }
    };
    log_line(&app, &format!("Settings: {}", settings.display()));

    #[cfg(target_os = "windows")]
    {
        let exe_string = exe.to_string_lossy().to_string();
        let settings_string = settings.to_string_lossy().to_string();
        let working_dir = exe.parent().unwrap_or(Path::new(".")).to_string_lossy().to_string();

        log_line(&app, &format!("Launching Mate from working directory: {working_dir}"));

        let output = Command::new("cmd.exe")
            .args([
                "/C",
                "start",
                "",
                "/D",
                &working_dir,
                &exe_string,
                "--savefile",
                &settings_string,
            ])
            .stdin(Stdio::null())
            .output()
            .map_err(|err| {
                let message = format!("Failed to invoke Windows start: {err}");
                log_line(&app, &message);
                message
            })?;

        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let message = format!(
                "Windows start failed (status {}): {}",
                output.status,
                if detail.is_empty() { "no cmd error output" } else { &detail }
            );
            log_line(&app, &message);
            return Err(message);
        }

        log_line(&app, "Mate launch command accepted by Windows.");
        log_line(&app, "Closing ZOYA now.");
        app.exit(0);
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let child = Command::new(&exe)
            .arg("--savefile")
            .arg(&settings)
            .current_dir(exe.parent().unwrap_or(Path::new(".")))
            .stdin(Stdio::null())
            .spawn()
            .map_err(|err| {
                let message = format!("Failed to start MateEngineX.exe: {err}");
                log_line(&app, &message);
                message
            })?;

        if let Ok(mut slot) = process_slot().lock() {
            *slot = Some(child);
        }

        app.exit(0);
        Ok(())
    }
}

pub fn stop<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    if let Ok(mut slot) = process_slot().lock() {
        if let Some(child) = slot.as_mut() {
            let _ = child.kill();
            let _ = child.wait();
        }
        *slot = None;
    }

    if let Some(main) = app.get_webview_window("main") {
        main.show().map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
    }

    Ok(())
}
