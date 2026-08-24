use std::path::PathBuf;
use tauri::Manager;

const VISUAL_MESH_CACHE_VERSION: &str = "1.90-25346";

fn visual_mesh_cache_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("mesh-cache").join(VISUAL_MESH_CACHE_VERSION))
        .map_err(|cause| format!("Cannot resolve local mesh-cache directory: {cause}"))
}

#[tauri::command]
fn visual_mesh_cache_manifest(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = visual_mesh_cache_directory(&app)?.join("manifest.json");
    if !path.is_file() {
        return Ok(None);
    }
    std::fs::read_to_string(&path)
        .map(Some)
        .map_err(|cause| format!("Cannot read visual mesh cache manifest {}: {cause}", path.display()))
}

#[tauri::command]
fn visual_mesh_cache_glb(app: tauri::AppHandle) -> Result<tauri::ipc::Response, String> {
    let path = visual_mesh_cache_directory(&app)?.join("vanilla-blocks.glb");
    let bytes = std::fs::read(&path)
        .map_err(|cause| format!("Cannot read visual mesh cache GLB {}: {cause}", path.display()))?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![visual_mesh_cache_manifest, visual_mesh_cache_glb])
        .run(tauri::generate_context!())
        .expect("failed to run Besiege Aero Analyzer");
}
