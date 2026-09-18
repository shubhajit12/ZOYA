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

    app.path()
        .app_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join("mate-companion")
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
            && path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.eq_ignore_ascii_case("MateEngineX.exe"))
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
        if let Some(install_root) = current_exe.parent() {
            paths.push(install_root.join("mate-companion").join("MateEngineX.exe"));
            paths.push(install_root.join("mate-companion").join("bin").join("MateEngineX.exe"));
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
        if let Some(install_root) = current_exe.parent() {
            candidates.push(install_root.join("mate-companion").join("Carlotta.vrm"));
            candidates.push(install_root.join("mate-companion").join("bin").join("Carlotta.vrm"));
        }
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("mate-companion").join("Carlotta.vrm"));
        candidates.push(resource_dir.join("mate-companion").join("bin").join("Carlotta.vrm"));
    }

    candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| "Carlotta.vrm was not found in the installed ZOYA mate-companion directory or Tauri resources".to_string())
}

fn write_carlotta_settings<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    carlotta: &PathBuf,
) -> Result<PathBuf, String> {
    let app_data = app.path().app_data_dir().map_err(|err| err.to_string())?;
    let handoff_dir = app_data.join("mate-companion");

    fs::create_dir_all(&handoff_dir)
        .map_err(|err| format!("Failed to create Mate handoff directory: {err}"))?;

    let settings_path = handoff_dir.join("zoya-settings.json");
    let json = serde_json::json!({
        "selectedModelPath": carlotta.to_string_lossy().to_string(),
        "isTopmost": true,
        "enableWindowSitting": true,
        "enableRandomAvatar": false,
        "enableLocomotion": false,
        "settingsVersion": 1
    });

    fs::write(
        &settings_path,
        serde_json::to_vec_pretty(&json).map_err(|err| err.to_string())?,
    )
    .map_err(|err| format!("Failed to prepare Mate settings: {err}"))?;

    Ok(settings_path)
}

pub fn start<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    log_line(&app, "=== Mate handoff started ===");

    let packaged_exe = match find_mate_executable(&app) {
        Some(path) => path,
        None => {
            let resource_dir = app
                .path()
                .resource_dir()
                .map(|p| p.display().to_string())
                .unwrap_or_else(|_| "<unavailable>".to_string());
            let message = format!(
                "MateEngineX.exe was not found. Checked packaged resources under {resource_dir}."
            );
            log_line(&app, &message);
            return Err(message);
        }
    };

    log_line(&app, &format!("Found Mate executable: {}", packaged_exe.display()));

    let carlotta = match find_carlotta(&app) {
        Ok(path) => path,
        Err(err) => {
            log_line(&app, &err);
            return Err(err);
        }
    };

    log_line(&app, &format!("Found Carlotta avatar: {}", carlotta.display()));

    let settings = match write_carlotta_settings(&app, &carlotta) {
        Ok(path) => path,
        Err(err) => {
            log_line(&app, &err);
            return Err(err);
        }
    };

    log_line(&app, &format!("Mate settings: {}", settings.display()));

    #[cfg(target_os = "windows")]
    {
        // Use PowerShell Start-Process rather than Win32_Process.Create.
        // This gives Windows a normal detached desktop process while avoiding
        // Tauri's process/job lifetime taking Mate down with ZOYA.
        let exe_arg = packaged_exe.to_string_lossy().replace("'", "''");
        let settings_arg = settings.to_string_lossy().replace("'", "''");
        let working_dir = packaged_exe
            .parent()
            .map(|p| p.to_string_lossy().replace("'", "''"))
            .unwrap_or_default();

        let ps_script = format!(
            "$p=Start-Process -FilePath '{}' -ArgumentList @('--savefile','{}') -WorkingDirectory '{}' -WindowStyle Normal -PassThru; Write-Output $p.Id",
            exe_arg, settings_arg, working_dir
        );

        log_line(&app, "Launching MateEngineX.exe with Start-Process...");

        let output = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-WindowStyle",
                "Hidden",
                "-Command",
                &ps_script,
            ])
            .stdin(Stdio::null())
            .output()
            .map_err(|err| {
                let message = format!("Failed to start PowerShell Mate launcher: {err}");
                log_line(&app, &message);
                message
            })?;

        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let message = format!(
                "Mate Start-Process failed (status {}): {}",
                output.status,
                if detail.is_empty() { "no PowerShell error output" } else { &detail }
            );
            log_line(&app, &message);
            return Err(message);
        }

        let pid = String::from_utf8_lossy(&output.stdout).trim().to_string();
        log_line(&app, &format!("MateEngineX.exe started (PID={pid})."));
        log_line(&app, "Mate handoff successful; closing ZOYA now.");
        app.exit(0);
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let child = Command::new(&packaged_exe)
            .arg("--savefile")
            .arg(&settings)
            .current_dir(packaged_exe.parent().unwrap_or(Path::new(".")))
            .stdin(Stdio::null())
            .spawn()
            .map_err(|err| {
                let message = format!("Failed to start MateEngineX.exe at {}: {err}", packaged_exe.display());
                log_line(&app, &message);
                message
            })?;

        let mut slot = process_slot()
            .lock()
            .map_err(|_| "Mate process state is unavailable".to_string())?;
        *slot = Some(child);

        log_line(&app, "Mate process spawned; closing ZOYA now.");
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
        main.show().map_err(|err| err.to_string())?;
        main.set_focus().map_err(|err| err.to_string())?;
    }

    Ok(())
}
