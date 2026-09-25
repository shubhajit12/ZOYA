use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
#[cfg(target_os = "windows")]
const CREATE_NEW_CONSOLE: u32 = 0x00000010;

fn bridge_resource_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let exe = app.path()
        .resolve("minecraft-bridge/MinecraftBridge.exe", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    exe.parent()
        .map(PathBuf::from)
        .ok_or_else(|| "Minecraft Bridge resource directory is unavailable.".to_string())
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("minecraft");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("config.json"))
}

fn post_bridge(path: &str, body: Option<&str>) -> Result<(), String> {
    let address: std::net::SocketAddr = "127.0.0.1:32123"
        .parse()
        .map_err(|e: std::net::AddrParseError| e.to_string())?;
    let client = std::net::TcpStream::connect_timeout(
        &address,
        Duration::from_millis(500),
    ).map_err(|e| e.to_string())?;
    client.set_write_timeout(Some(Duration::from_millis(500))).map_err(|e| e.to_string())?;
    client.set_read_timeout(Some(Duration::from_millis(500))).map_err(|e| e.to_string())?;
    use std::io::{Read, Write};
    let payload = body.unwrap_or("");
    let request = if payload.is_empty() {
        format!("POST {path} HTTP/1.1\r\nHost: 127.0.0.1:32123\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
    } else {
        format!("POST {path} HTTP/1.1\r\nHost: 127.0.0.1:32123\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{payload}", payload.len())
    };
    let mut stream = client;
    stream.write_all(request.as_bytes()).map_err(|e| format!("Failed to contact Minecraft Bridge: {e}"))?;
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    if response.starts_with("HTTP/1.1 2") { Ok(()) } else { Err(format!("Minecraft Bridge request failed: {response}")) }
}

pub fn launch(app: &AppHandle, config_json: &str) -> Result<(), String> {
    let exe = app.path()
        .resolve("minecraft-bridge/MinecraftBridge.exe", tauri::path::BaseDirectory::Resource)
        .map_err(|e| e.to_string())?;
    if !exe.is_file() {
        return Err("MinecraftBridge.exe is not bundled.".to_string());
    }

    let config = config_path(app)?;
    fs::write(&config, config_json).map_err(|e| format!("Failed to save Minecraft settings: {e}"))?;

    let address: std::net::SocketAddr = "127.0.0.1:32123"
        .parse()
        .map_err(|e: std::net::AddrParseError| e.to_string())?;
    if std::net::TcpStream::connect_timeout(
        &address,
        Duration::from_millis(150),
    ).is_ok() {
        return Ok(());
    }

    let mut command = Command::new(&exe);
    command.current_dir(exe.parent().unwrap_or_else(|| std::path::Path::new(".")))
        .env("ZOYA_MINECRAFT_CONFIG", &config_json_path(&config))
        .stdin(std::process::Stdio::inherit())
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit());
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NEW_CONSOLE);

    command.spawn().map_err(|e| format!("Failed to launch MinecraftBridge.exe: {e}"))?;

    for _ in 0..50 {
        if std::net::TcpStream::connect(("127.0.0.1", 32123)).is_ok() {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err("Minecraft Bridge terminal was launched, but its HTTP service did not become ready.".to_string())
}

fn config_json_path(path: &PathBuf) -> String {
    path.to_string_lossy().into_owned()
}

pub fn stop() -> Result<(), String> {
    if std::net::TcpStream::connect(("127.0.0.1", 32123)).is_err() {
        return Ok(());
    }
    post_bridge("/shutdown", None)
}
