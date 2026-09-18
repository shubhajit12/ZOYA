use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use tauri::Manager;

static MATE_PROCESS: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

fn process_slot() -> &'static Mutex<Option<Child>> {
    MATE_PROCESS.get_or_init(|| Mutex::new(None))
}

fn log_line<R: tauri::Runtime>(app: &tauri::AppHandle<R>, message: &str) {
    println!("[ZOYA Mate] {message}");
    if let Ok(app_data) = app.path().app_data_dir() {
        let dir = app_data.join("mate-companion");
        if fs::create_dir_all(&dir).is_ok() {
            let path = dir.join("handoff.log");
            let line = format!("{message}\n");
            use std::io::Write;
            if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) {
                let _ = file.write_all(line.as_bytes());
            }
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

    // Installed ZOYA layout: <install-root>\\zoya.exe + <install-root>\\mate-companion.
    // Resolve this first so the user's chosen install directory is always respected.
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(install_root) = current_exe.parent() {
            paths.push(
                install_root
                    .join("mate-companion")
                    .join("MateEngineX.exe"),
            );
            paths.push(
                install_root
                    .join("mate-companion")
                    .join("bin")
                    .join("MateEngineX.exe"),
            );
        }
    }

    // Development/Tauri-resource fallback.
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

    // Match Carlotta to the same installed root used for MateEngineX.exe.
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(install_root) = current_exe.parent() {
            candidates.push(install_root.join("mate-companion").join("Carlotta.vrm"));
            candidates.push(
                install_root
                    .join("mate-companion")
                    .join("bin")
                    .join("Carlotta.vrm"),
            );
        }
    }

    // Development/Tauri-resource fallback.
    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("mate-companion").join("Carlotta.vrm"));
        candidates.push(
            resource_dir
                .join("mate-companion")
                .join("bin")
                .join("Carlotta.vrm"),
        );
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
    {
        let mut slot = process_slot()
            .lock()
            .map_err(|_| "Mate process state is unavailable".to_string())?;

        if let Some(child) = slot.as_mut() {
            match child.try_wait() {
                Ok(None) => return Ok(()),
                Ok(Some(_)) | Err(_) => *slot = None,
            }
        }
    }

    let packaged_exe = find_mate_executable(&app).ok_or_else(|| {
        let resource_dir = app
            .path()
            .resource_dir()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|_| "<unavailable>".to_string());

        format!(
            "MateEngineX.exe was not found. Checked packaged resources under {resource_dir}."
        )
    })?;

    let carlotta = find_carlotta(&app)?;
    let settings = write_carlotta_settings(&app, &carlotta)?;

    log_line(
        &app,
        &format!("Installed Mate executable: {}", packaged_exe.display()),
    );
    log_line(&app, &format!("Installed Mate avatar: {}", carlotta.display()));
    log_line(&app, &format!("Mate settings: {}", settings.display()));

    // Launch Mate directly from the user's installed ZOYA directory.
    // current_exe().parent() resolves the actual install root, regardless of
    // which drive or folder the user selected. No runtime copy is made.
    let exe = packaged_exe;
    let working_dir = exe.parent().map(PathBuf::from);

    let stdout_log = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("mate-companion")
        .join("mate-stdout.log");

    let stderr_log = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("mate-companion")
        .join("mate-stderr.log");

    let stdout = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&stdout_log)
        .map_err(|err| format!("Failed to open Mate stdout log: {err}"))?;

    let stderr = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&stderr_log)
        .map_err(|err| format!("Failed to open Mate stderr log: {err}"))?;

    let mut command = Command::new(&exe);

    if let Some(dir) = working_dir {
        command.current_dir(dir);
    }

    command
        .arg("--savefile")
        .arg(&settings)
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout))
        .stderr(Stdio::from(stderr));

    // ZOYA is intentionally going to exit after the handoff. On Windows,
    // launch Mate in a detached process group so it is independent of ZOYA's
    // lifetime. CREATE_BREAKAWAY_FROM_JOB also allows Mate to escape a parent
    // job object when the launcher/runtime places ZOYA in one.
    #[cfg(target_os = "windows")]
    {
        const DETACHED_PROCESS: u32 = 0x00000008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
        const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x01000000;
        command.creation_flags(
            DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB,
        );
    }

    // Use Windows' native WMI process creation for the packaged handoff.
    // This avoids inheriting the Tauri/launcher Job Object, which can otherwise
    // terminate Mate when ZOYA exits. It also means there is no fragile Child
    // handle to keep alive after app.exit().
    #[cfg(target_os = "windows")]
    {
        let command_line = format!(
            r#""{}" --savefile "{}""#,
            exe.display(),
            settings.display()
        );
        let escaped_command_line = command_line.replace("'", "''");
        let escaped_working_dir = exe
            .parent()
            .map(|p| p.display().to_string())
            .unwrap_or_default()
            .replace("'", "''");

        let ps_script = format!(
            "$args=@{{CommandLine='{}';CurrentDirectory='{}'}};              $r=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments $args;              if($r.ReturnValue -ne 0) {{ exit [int]$r.ReturnValue }};              Write-Output $r.ProcessId",
            escaped_command_line,
            escaped_working_dir
        );

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
                let message = format!("Failed to launch detached Mate process: {err}");
                log_line(&app, &message);
                message
            })?;

        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let message = format!(
                "Windows detached Mate launch failed (status {}): {}",
                output.status,
                if detail.is_empty() { "no PowerShell error output" } else { &detail }
            );
            log_line(&app, &message);
            return Err(message);
        }

        let pid = String::from_utf8_lossy(&output.stdout).trim().to_string();
        log_line(
            &app,
            &format!(
                "MateEngineX.exe launched independently via Win32_Process.Create (PID={pid}); waiting for Unity startup.",
            ),
        );

        std::thread::sleep(Duration::from_millis(1500));

        log_line(&app, "Mate handoff complete; requesting full ZOYA exit.");
        app.exit(0);
        return Ok(());
    }

    #[cfg(not(target_os = "windows"))]
    {
        let child = command.spawn().map_err(|err| {
            let message = format!("Failed to start MateEngineX.exe at {}: {err}", exe.display());
            log_line(&app, &message);
            message
        })?;

        let mut slot = process_slot()
            .lock()
            .map_err(|_| "Mate process state is unavailable".to_string())?;
        *slot = Some(child);

        log_line(&app, "Mate process spawned; requesting ZOYA exit.");
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
