use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use std::sync::{Mutex, OnceLock};

use tauri::Manager;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
#[cfg(target_os = "windows")]
const DETACHED_PROCESS: u32 = 0x0000_0008;

static MATE_PROCESS: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

fn process_slot() -> &'static Mutex<Option<Child>> {
    MATE_PROCESS.get_or_init(|| Mutex::new(None))
}

fn handoff_log_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> PathBuf {
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
        if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
            let _ = writeln!(file, "{message}");
        }
    }
}

fn resource_file<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    relative: &str,
) -> Option<PathBuf> {
    app.path()
        .resolve(relative, tauri::path::BaseDirectory::Resource)
        .ok()
        .filter(|path| path.is_file())
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

fn find_mate_executable<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Option<PathBuf> {
    if let Some(path) = resource_file(app, "mate-companion/bin/MateEngineX.exe") {
        return Some(path);
    }
    if let Some(path) = resource_file(app, "mate-companion/MateEngineX.exe") {
        return Some(path);
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        if let Some(found) = recursive_find_exe(&resource_dir) {
            return Some(found);
        }
    }

    None
}

fn find_carlotta<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> Result<PathBuf, String> {
    let candidates = [
        "mate-companion/Carlotta.vrm",
        "mate-companion/bin/Carlotta.vrm",
    ];

    for relative in candidates {
        if let Some(path) = resource_file(app, relative) {
            return Ok(path);
        }
    }

    Err("Carlotta.vrm was not found in the packaged Mate companion resources".to_string())
}

fn write_carlotta_settings<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    carlotta: &Path,
) -> Result<PathBuf, String> {
    let dir = handoff_log_dir(app);
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create Mate settings directory: {e}"))?;

    let path = dir.join("zoya-settings.json");
    let json = serde_json::json!({
        "selectedModelPath": carlotta.to_string_lossy().to_string(),
        "isTopmost": true,
        "enableWindowSitting": true,
        "enableRandomAvatar": false,
        "enableLocomotion": false,
        "settingsVersion": 1
    });

    fs::write(
        &path,
        serde_json::to_vec_pretty(&json).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Failed to write Mate settings: {e}"))?;

    Ok(path)
}

#[cfg(target_os = "windows")]
fn ps_quote(value: &str) -> String {
    format!("'{}'", value.replace(''', "''"))
}

#[cfg(target_os = "windows")]
fn start_restore_watcher<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    mate_pid: u32,
) -> Result<(), String> {
    let zoya_exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let zoya_path = zoya_exe.to_string_lossy().to_string();

    // This small detached watcher survives ZOYA exiting. When Mate closes,
    // it starts the same ZOYA executable from the user's actual install path.
    let command = format!(
        "$p=Get-Process -Id {mate_pid} -ErrorAction SilentlyContinue;          if($p){{Wait-Process -Id {mate_pid} -ErrorAction SilentlyContinue}};          Start-Process -FilePath {} -WorkingDirectory {}",
        ps_quote(&zoya_path),
        ps_quote(
            zoya_exe
                .parent()
                .unwrap_or(Path::new("."))
                .to_string_lossy()
                .as_ref()
        )
    );

    Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &command,
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS)
        .spawn()
        .map(|_| ())
        .map_err(|e| {
            log_line(
                app,
                &format!("Failed to start ZOYA restore watcher: {e}"),
            );
            e.to_string()
        })
}

pub fn start<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    log_line(&app, "=== Mate handoff started ===");

    // The legacy C# companion engine must release all native companion state
    // before Mate takes ownership of the desktop character.
    companion_engine::stop();
    companion_tracker::clear_target();

    let exe = find_mate_executable(&app).ok_or_else(|| {
        let message = "MateEngineX.exe was not found in the bundled Mate resources".to_string();
        log_line(&app, &message);
        message
    })?;
    log_line(&app, &format!("Mate executable: {}", exe.display()));

    let working_dir = exe
        .parent()
        .ok_or_else(|| "Mate executable has no parent directory".to_string())?;
    let data_dir = working_dir.join("MateEngineX_Data");
    if !data_dir.is_dir() {
        let message = format!(
            "Mate runtime is incomplete: missing {}",
            data_dir.display()
        );
        log_line(&app, &message);
        return Err(message);
    }
    log_line(&app, &format!("Mate working directory: {}", working_dir.display()));

    let carlotta = find_carlotta(&app)?;
    log_line(&app, &format!("Carlotta: {}", carlotta.display()));

    let settings = write_carlotta_settings(&app, &carlotta)?;
    log_line(&app, &format!("Settings: {}", settings.display()));

    let unity_log = handoff_log_dir(&app).join("mate-unity.log");
    let _ = fs::remove_file(&unity_log);

    #[cfg(target_os = "windows")]
    {
        log_line(
            &app,
            &format!("Launching Mate with Unity log: {}", unity_log.display()),
        );

        let mut child = Command::new(&exe)
            .arg("--savefile")
            .arg(&settings)
            .arg("-logFile")
            .arg(&unity_log)
            .current_dir(working_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .creation_flags(CREATE_NEW_PROCESS_GROUP)
            .spawn()
            .map_err(|err| {
                let message = format!("Failed to start MateEngineX.exe: {err}");
                log_line(&app, &message);
                message
            })?;

        let pid = child.id();
        log_line(&app, &format!("Mate process created (PID {pid})."));

        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            match child.try_wait() {
                Ok(Some(status)) => {
                    let unity_tail = fs::read_to_string(&unity_log)
                        .ok()
                        .map(|text| {
                            let start = text.len().saturating_sub(8000);
                            text[start..].to_string()
                        })
                        .unwrap_or_else(|| "<Unity log was not created>".to_string());

                    let message = format!(
                        "Mate exited during startup with {status}. Unity log: {}\n{}",
                        unity_log.display(),
                        unity_tail
                    );
                    log_line(&app, &message);
                    return Err(message);
                }
                Ok(None) => {}
                Err(err) => {
                    let message = format!("Could not verify Mate startup: {err}");
                    log_line(&app, &message);
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(message);
                }
            }

            if Instant::now() >= deadline {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }

        if let Err(err) = start_restore_watcher(&app, pid) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(err);
        }

        log_line(&app, "Mate survived startup verification. Closing ZOYA.");
        drop(child);
        app.exit(0);
        Ok(())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let child = Command::new(&exe)
            .arg("--savefile")
            .arg(&settings)
            .arg("-logFile")
            .arg(&unity_log)
            .current_dir(working_dir)
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
