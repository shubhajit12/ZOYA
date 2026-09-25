use std::env;
use std::path::PathBuf;
use std::process::{Command, Stdio};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NEW_CONSOLE: u32 = 0x00000010;

fn main() {
    let bridge_dir = env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from))
        .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")));

    let node = bridge_dir.join("node.exe");
    let script = bridge_dir.join("index.mjs");

    println!("=== ZOYA Minecraft Bridge ===");
    println!("Bridge directory: {}", bridge_dir.display());
    println!("Node runtime: {}", node.display());
    println!("Bridge script: {}", script.display());
    println!("");

    if !node.is_file() {
        eprintln!("ERROR: bundled node.exe was not found.");
        return;
    }
    if !script.is_file() {
        eprintln!("ERROR: bridge index.mjs was not found.");
        return;
    }

    let config = env::var("ZOYA_MINECRAFT_CONFIG").unwrap_or_else(|_| {
        bridge_dir.join("config.json").to_string_lossy().into_owned()
    });

    println!("Config: {config}");
    println!("Starting Mineflayer bridge...");
    println!("");

    let mut command = Command::new(&node);
    command.arg(&script)
        .env("ZOYA_MINECRAFT_CONFIG", &config)
        .current_dir(&bridge_dir)
        .stdin(Stdio::inherit())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    match command.spawn() {
        Ok(mut child) => match child.wait() {
            Ok(status) => println!("Minecraft Bridge exited: {status}"),
            Err(error) => eprintln!("ERROR waiting for Minecraft Bridge: {error}"),
        },
        Err(error) => eprintln!("ERROR starting bundled Node runtime: {error}"),
    }
}
