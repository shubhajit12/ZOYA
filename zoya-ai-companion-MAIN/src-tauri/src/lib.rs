#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            println!("ZOYA Desktop Native Engine initialized");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running zoya tauri application");
}
