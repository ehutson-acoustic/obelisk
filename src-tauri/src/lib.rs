pub mod checkpoints;

use std::path::PathBuf;

use checkpoints::{Checkpoint, CheckpointStatus};

/// The webview has no access to the process environment, so the shell to spawn
/// has to come from the Rust side.
#[tauri::command]
fn default_shell() -> String {
    #[cfg(windows)]
    {
        std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".to_string())
    }
    #[cfg(not(windows))]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
    }
}

#[tauri::command]
fn git_available() -> bool {
    checkpoints::git_available()
}

#[tauri::command]
fn checkpoint_status(project: PathBuf, file: PathBuf) -> Result<CheckpointStatus, String> {
    checkpoints::status(&project, &file)
}

#[tauri::command]
fn checkpoint_create(
    project: PathBuf,
    file: PathBuf,
    message: String,
) -> Result<Option<String>, String> {
    checkpoints::create(&project, &file, &message)
}

#[tauri::command]
fn checkpoint_from_content(
    project: PathBuf,
    file: PathBuf,
    content: String,
    message: String,
) -> Result<Option<String>, String> {
    checkpoints::create_from_content(&project, &file, &content, &message)
}

#[tauri::command]
fn checkpoint_list(project: PathBuf, file: PathBuf) -> Result<Vec<Checkpoint>, String> {
    checkpoints::list(&project, &file)
}

#[tauri::command]
fn checkpoint_restore(project: PathBuf, file: PathBuf, sha: String) -> Result<(), String> {
    checkpoints::restore(&project, &file, &sha)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_pty::init())
        .invoke_handler(tauri::generate_handler![
            default_shell,
            git_available,
            checkpoint_status,
            checkpoint_create,
            checkpoint_from_content,
            checkpoint_list,
            checkpoint_restore
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
