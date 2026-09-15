use serde::{Deserialize, Serialize};
use std::sync::{Mutex, OnceLock};
use tauri::{Emitter, Manager, PhysicalPosition, Position};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WindowTarget {
    pub hwnd: isize,
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

static TARGET: OnceLock<Mutex<Option<isize>>> = OnceLock::new();

fn target_slot() -> &'static Mutex<Option<isize>> {
    TARGET.get_or_init(|| Mutex::new(None))
}

#[cfg(target_os = "windows")]
#[repr(C)]
#[derive(Clone, Copy, Default)]
struct Point {
    x: i32,
    y: i32,
}

#[cfg(target_os = "windows")]
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub struct WinRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[cfg(target_os = "windows")]
#[link(name = "user32")]
extern "system" {