use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use std::sync::{Mutex, OnceLock};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use tauri::{path::BaseDirectory, AppHandle, Manager};
use crate::companion_tracker::WindowTarget;

pub struct DragDropResult {
    pub target: Option<WindowTarget>,
    pub cursor_x: i32,
    pub cursor_y: i32,
}

struct EngineProcess {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

static ENGINE: OnceLock<Mutex<Option<EngineProcess>>> = OnceLock::new();

fn engine_slot() -> &'static Mutex<Option<EngineProcess>> {
    ENGINE.get_or_init(|| Mutex::new(None))
}

pub fn start(app: &AppHandle) -> bool {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        return false;
    }

    #[cfg(target_os = "windows")]
    {
        let Ok(path) = app.path().resolve("companion-engine/ZOYA.CompanionEngine.exe", BaseDirectory::Resource) else {
            eprintln!("[ZOYA] Companion engine resource path could not be resolved");
            return false;
        };
        if !path.exists() {
            eprintln!("[ZOYA] Companion engine not bundled yet: {}", path.display());
            return false;
        }
        let Ok(mut child) = Command::new(&path)
            .creation_flags(0x08000000)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
        else {
            eprintln!("[ZOYA] Failed to start companion engine: {}", path.display());
            return false;
        };
        let Some(stdin) = child.stdin.take() else { let _ = child.kill(); return false; };
        let Some(stdout) = child.stdout.take() else { let _ = child.kill(); return false; };
        *engine_slot().lock().expect("companion engine lock poisoned") = Some(EngineProcess { child, stdin, stdout: BufReader::new(stdout) });
        println!("[ZOYA] C# companion engine started");
        true
    }
}

pub fn stop() {
    let mut slot = engine_slot().lock().expect("companion engine lock poisoned");
    if let Some(mut engine) = slot.take() {
        let _ = writeln!(engine.stdin, "{}", json!({ "op": "clear" }));
        let _ = engine.stdin.flush();
        let _ = engine.child.kill();
        let _ = engine.child.wait();
        println!("[ZOYA] C# companion engine stopped for Mate handoff");
    }
}

pub fn is_running() -> bool {
    engine_slot().lock().expect("companion engine lock poisoned").is_some()
}

#[cfg(target_os = "windows")]
pub fn target_under_cursor(companion_hwnd: isize) -> Option<WindowTarget> {
    let mut slot = engine_slot().lock().expect("companion engine lock poisoned");
    let engine = slot.as_mut()?;
    let command = json!({ "op": "target", "companionHwnd": companion_hwnd });
    writeln!(engine.stdin, "{}", command).ok()?;
    engine.stdin.flush().ok()?;
    let mut line = String::new();
    engine.stdout.read_line(&mut line).ok()?;
    let value: Value = serde_json::from_str(line.trim()).ok()?;
    let target = value.get("target")?.clone();
    if target.is_null() { return None; }
    serde_json::from_value(target).ok()
}

#[cfg(not(target_os = "windows"))]
pub fn target_under_cursor(_companion_hwnd: isize) -> Option<WindowTarget> { None }

#[cfg(target_os = "windows")]
pub fn start_drag(companion_hwnd: isize, anchor_x: i32, anchor_y: i32) -> bool {
    let mut slot = engine_slot().lock().expect("companion engine lock poisoned");
    let Some(engine) = slot.as_mut() else { return false };
    let command = json!({ "op": "drag_start", "companionHwnd": companion_hwnd, "anchorX": anchor_x, "anchorY": anchor_y });
    if writeln!(engine.stdin, "{}", command).is_err() || engine.stdin.flush().is_err() { return false; }
    true
}

#[cfg(not(target_os = "windows"))]
pub fn start_drag(_companion_hwnd: isize, _anchor_x: i32, _anchor_y: i32) -> bool { false }

#[cfg(target_os = "windows")]
pub fn finish_drag(anchor_x: i32, anchor_y: i32) -> Option<DragDropResult> {
    let mut slot = engine_slot().lock().expect("companion engine lock poisoned");
    let engine = slot.as_mut()?;
    let command = json!({ "op": "drag_finish", "anchorX": anchor_x, "anchorY": anchor_y });
    writeln!(engine.stdin, "{}", command).ok()?;
    engine.stdin.flush().ok()?;
    let mut line = String::new();
    engine.stdout.read_line(&mut line).ok()?;
    let value: Value = serde_json::from_str(line.trim()).ok()?;
    let cursor_x = value.get("cursorX")?.as_i64()? as i32;
    let cursor_y = value.get("cursorY")?.as_i64()? as i32;
    let target = value.get("target")?.clone();
    let target = if target.is_null() { None } else { serde_json::from_value(target).ok() };
    Some(DragDropResult { target, cursor_x, cursor_y })
}

#[cfg(not(target_os = "windows"))]
pub fn finish_drag(_anchor_x: i32, _anchor_y: i32) -> Option<DragDropResult> { None }

pub fn bind(companion_hwnd: isize, target_hwnd: isize) -> bool {
    let mut slot = engine_slot().lock().expect("companion engine lock poisoned");
    let Some(engine) = slot.as_mut() else { return false };
    let command = json!({ "op": "bind", "companionHwnd": companion_hwnd, "hwnd": target_hwnd });
    if writeln!(engine.stdin, "{}", command).is_err() || engine.stdin.flush().is_err() { return false; }
    true
}

pub fn clear() {
    let mut slot = engine_slot().lock().expect("companion engine lock poisoned");
    let Some(engine) = slot.as_mut() else { return };
    let command = json!({ "op": "clear" });
    let _ = writeln!(engine.stdin, "{}", command);
    let _ = engine.stdin.flush();
}

impl Drop for EngineProcess {
    fn drop(&mut self) { let _ = self.child.kill(); }
}
