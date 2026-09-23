use std::process::{Child, Command, Stdio};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Manager};

static SERVER_PROCESS: OnceLock<Mutex<Option<Child>>> = OnceLock::new();

fn process_slot() -> &'static Mutex<Option<Child>> {
    SERVER_PROCESS.get_or_init(|| Mutex::new(None))
}

pub fn start(app: &AppHandle) {
    #[cfg(not(windows))]
    {
        let _ = app;
        return;
    }

    #[cfg(windows)]
    {
        let resource_dir = match app.path().resource_dir() {
            Ok(path) => path,
            Err(err) => {
                eprintln!("[ZOYA] Could not locate resource directory for API server: {err}");
                return;
            }
        };

        let server_root = resource_dir.join("server");
        let node = server_root.join("node.exe");
        let server = server_root.join("dist").join("server.cjs");

        if !node.exists() || !server.exists() {
            eprintln!(
                "[ZOYA] Bundled API server is missing. node={} server={}",
                node.display(),
                server.display()
            );
            return;
        }

        if let Ok(mut slot) = process_slot().lock() {
            if let Some(child) = slot.as_mut() {
                if child.try_wait().ok().flatten().is_none() {
                    return;
                }
            }

            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;

            let child = Command::new(&node)
                .arg(&server)
                .current_dir(&server_root)
                .env("NODE_ENV", "production")
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .creation_flags(CREATE_NO_WINDOW)
                .spawn();

            match child {
                Ok(child) => {
                    *slot = Some(child);
                    eprintln!("[ZOYA] Bundled API server started in background.");
                }
                Err(err) => {
                    eprintln!("[ZOYA] Failed to start bundled API server: {err}");
                }
            }
        }

        // Never block Tauri startup waiting for Node/Express.
        // The first API request can retry/fail normally if the server is still booting.
        std::thread::spawn(|| {
            for _ in 0..50 {
                if std::net::TcpStream::connect(("127.0.0.1", 3000)).is_ok() {
                    eprintln!("[ZOYA] Bundled API server is ready.");
                    return;
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            eprintln!("[ZOYA] Bundled API server did not become reachable within 5 seconds.");
        });
    }
}

pub fn stop() {
    if let Ok(mut slot) = process_slot().lock() {
        if let Some(mut child) = slot.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}
