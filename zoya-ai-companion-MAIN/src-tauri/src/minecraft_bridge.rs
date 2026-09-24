use std::fs;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

static BRIDGE_PROCESS: OnceLock<Mutex<Option<Child>>> = OnceLock::new();
fn slot() -> &'static Mutex<Option<Child>> { BRIDGE_PROCESS.get_or_init(|| Mutex::new(None)) }

fn bridge_dir(app: &AppHandle) -> PathBuf {
  app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir().join("ZOYA")).join("minecraft-bridge")
}
fn resource_file(app: &AppHandle) -> Option<PathBuf> {
  app.path().resolve("minecraft-bridge/index.mjs", tauri::path::BaseDirectory::Resource).ok().filter(|p| p.is_file())
}

pub fn start(app: &AppHandle) -> Result<(), String> {
  let bridge = resource_file(app).ok_or_else(|| "Minecraft Bridge runtime is not bundled.".to_string())?;
  let node = app.path().resolve("server/node.exe", tauri::path::BaseDirectory::Resource).map_err(|e| e.to_string())?;
  if !node.is_file() { return Err("Bundled Node runtime is missing for Minecraft Bridge.".to_string()); }
  let dir = bridge_dir(app);
  fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
  let config = dir.join("config.json");

  if let Ok(mut guard) = slot().lock() {
    if let Some(child) = guard.as_mut() {
      if child.try_wait().ok().flatten().is_none() { return Ok(()); }
    }
    let mut command = Command::new(&node);
    command.arg(&bridge).env("ZOYA_MINECRAFT_CONFIG", &config).current_dir(&dir).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    *guard = Some(command.spawn().map_err(|e| format!("Failed to start Minecraft Bridge: {e}"))?);
  }
  for _ in 0..50 {
    if std::net::TcpStream::connect(("127.0.0.1", 32123)).is_ok() { return Ok(()); }
    std::thread::sleep(Duration::from_millis(100));
  }
  Err("Minecraft Bridge did not become ready on 127.0.0.1:32123.".to_string())
}

pub fn stop() {
  if let Ok(mut guard) = slot().lock() {
    if let Some(mut child) = guard.take() { let _ = child.kill(); let _ = child.wait(); }
  }
}
