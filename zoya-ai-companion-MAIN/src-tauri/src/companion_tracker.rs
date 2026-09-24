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
unsafe extern "system" {
    fn GetCursorPos(point: *mut Point) -> i32;
    fn WindowFromPoint(point: Point) -> *mut std::ffi::c_void;
    fn GetAncestor(hwnd: *mut std::ffi::c_void, flags: u32) -> *mut std::ffi::c_void;
    fn IsWindow(hwnd: *mut std::ffi::c_void) -> i32;
    fn IsWindowVisible(hwnd: *mut std::ffi::c_void) -> i32;
    fn IsIconic(hwnd: *mut std::ffi::c_void) -> i32;
    fn GetWindowRect(hwnd: *mut std::ffi::c_void, rect: *mut WinRect) -> i32;
    fn GetClassNameW(hwnd: *mut std::ffi::c_void, buffer: *mut u16, max_count: i32) -> i32;
    fn GetShellWindow() -> *mut std::ffi::c_void;
}

#[cfg(target_os = "windows")]
const GA_ROOT: u32 = 2;

#[cfg(target_os = "windows")]
fn class_name(hwnd: *mut std::ffi::c_void) -> String {
    let mut buffer = [0u16; 256];
    let len = unsafe { GetClassNameW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32) };
    String::from_utf16_lossy(&buffer[..len.max(0) as usize])
}

#[cfg(target_os = "windows")]
fn valid_surface(
    hwnd: *mut std::ffi::c_void,
    companion_hwnd: *mut std::ffi::c_void,
) -> Option<WindowTarget> {
    if hwnd.is_null()
        || hwnd == companion_hwnd
        || unsafe { IsWindow(hwnd) } == 0
        || unsafe { IsWindowVisible(hwnd) } == 0
        || unsafe { IsIconic(hwnd) } != 0
    {
        return None;
    }

    let root = unsafe { GetAncestor(hwnd, GA_ROOT) };
    if root.is_null()
        || root == companion_hwnd
        || unsafe { IsWindow(root) } == 0
        || unsafe { IsWindowVisible(root) } == 0
        || unsafe { IsIconic(root) } != 0
    {
        return None;
    }

    let shell = unsafe { GetShellWindow() };
    if root == shell {
        return None;
    }

    let class = class_name(root);
    if matches!(
        class.as_str(),
        "Shell_TrayWnd" | "Shell_SecondaryTrayWnd" | "WorkerW" | "Progman" | "Windows.UI.Core.CoreWindow"
    ) {
        return None;
    }

    let mut rect = WinRect::default();
    if unsafe { GetWindowRect(root, &mut rect) } == 0 {
        return None;
    }
    if rect.right - rect.left < 160 || rect.bottom - rect.top < 120 {
        return None;
    }

    Some(WindowTarget {
        hwnd: root as isize,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
    })
}

#[cfg(target_os = "windows")]
pub fn target_under_cursor(companion_hwnd: isize) -> Option<WindowTarget> {
    let mut point = Point::default();
    if unsafe { GetCursorPos(&mut point) } == 0 {
        return None;
    }

    let hwnd = unsafe { WindowFromPoint(point) };
    valid_surface(hwnd, companion_hwnd as *mut std::ffi::c_void)
}

#[cfg(target_os = "windows")]
pub fn target_rect(hwnd: isize) -> Option<WindowTarget> {
    let raw = hwnd as *mut std::ffi::c_void;
    if raw.is_null()
        || unsafe { IsWindow(raw) } == 0
        || unsafe { IsIconic(raw) } != 0
        || unsafe { IsWindowVisible(raw) } == 0
    {
        return None;
    }

    let class = class_name(raw);
    if matches!(
        class.as_str(),
        "Shell_TrayWnd" | "Shell_SecondaryTrayWnd" | "WorkerW" | "Progman" | "Windows.UI.Core.CoreWindow"
    ) {
        return None;
    }

    let mut rect = WinRect::default();
    if unsafe { GetWindowRect(raw, &mut rect) } == 0 {
        return None;
    }
    if rect.right <= rect.left || rect.bottom <= rect.top {
        return None;
    }

    Some(WindowTarget {
        hwnd,
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
    })
}

pub fn set_target(hwnd: Option<isize>) {
    *target_slot().lock().expect("companion target lock poisoned") = hwnd;
}

pub fn clear_target() {
    set_target(None);
}

pub fn current_target() -> Option<isize> {
    *target_slot().lock().expect("companion target lock poisoned")
}

#[cfg(target_os = "windows")]
pub fn start_tracking(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let mut last_position: Option<(i32, i32)> = None;

        loop {
            // Track at roughly the display refresh cadence instead of the old 20 Hz
            // polling interval. This keeps the companion visually attached while
            // the target window is being dragged or resized.
            std::thread::sleep(std::time::Duration::from_millis(16));

            let Some(hwnd) = current_target() else {
                last_position = None;
                continue;
            };
            let Some(target) = target_rect(hwnd) else {
                clear_target();
                last_position = None;
                let _ = app.emit("companion-surface-lost", ());
                continue;
            };

            let Some(companion) = app.get_webview_window("companion") else {
                continue;
            };
            let Ok(size) = companion.outer_size() else { continue };
            let width = size.width as i32;
            let height = size.height as i32;
            let target_width = target.right - target.left;

            let mut x = target.left + (target_width - width) / 2;
            x = x.clamp(target.left, (target.right - width).max(target.left));
            let y = target.top - height;
            let next_position = (x, y);

            // Avoid issuing redundant native window-position calls when the target
            // has not moved. This also reduces unnecessary WebView/compositor work.
            if last_position != Some(next_position) {
                let _ = companion.set_position(Position::Physical(PhysicalPosition::new(x, y)));
                last_position = Some(next_position);
            }
        }
    });
}

#[cfg(not(target_os = "windows"))]
pub fn start_tracking(_app: tauri::AppHandle) {}
