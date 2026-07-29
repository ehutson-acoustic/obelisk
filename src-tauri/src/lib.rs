pub mod checkpoints;
pub mod search;

use std::path::PathBuf;

use checkpoints::{Branches, Checkpoint, CheckpointStatus, RepoState};
use search::{SearchOptions, SearchOutcome};

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

/// Font families installed on this machine, de-duplicated and sorted.
///
/// ponytail: shells out instead of linking a font library. `fc-list` ships with
/// every Linux desktop and PowerShell with every Windows; macOS only has
/// fontconfig if the user installed it, so there it falls back to the families
/// the OS ships with. Pull in the `font-kit` crate if that fallback starts
/// mattering.
#[tauri::command]
fn system_fonts() -> Vec<String> {
    use std::process::Command;

    let output = if cfg!(windows) {
        Command::new("powershell")
            .args([
                "-NoProfile",
                "-Command",
                "(New-Object System.Drawing.Text.InstalledFontCollection).Families | ForEach-Object { $_.Name }",
            ])
            .output()
    } else {
        // Restricted to outline faces that can actually set Latin text — the
        // unfiltered list is mostly CJK and Indic families that would render a
        // markdown document as tofu.
        Command::new("fc-list")
            .args([":lang=en:outline=true", "--format", "%{family[0]}\n"])
            .output()
    };

    let mut families: Vec<String> = match output {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(|line| line.trim().to_string())
            .filter(|line| !line.is_empty())
            .collect(),
        _ => MACOS_FALLBACK_FONTS.iter().map(|f| f.to_string()).collect(),
    };

    families.sort_by_key(|f| f.to_lowercase());
    families.dedup_by_key(|f| f.to_lowercase());
    families
}

/// Only reached when font enumeration fails, which in practice means macOS
/// without fontconfig.
const MACOS_FALLBACK_FONTS: &[&str] = &[
    "Andale Mono",
    "Arial",
    "Avenir",
    "Courier New",
    "Georgia",
    "Helvetica",
    "Helvetica Neue",
    "Menlo",
    "Monaco",
    "Optima",
    "Palatino",
    "SF Mono",
    "Times New Roman",
    "Verdana",
];

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

/// Returns the content rather than writing it: the frontend writes through its
/// own save path so the watcher recognises the echo (DESIGN §3.6).
#[tauri::command]
fn checkpoint_content(project: PathBuf, file: PathBuf, sha: String) -> Result<String, String> {
    checkpoints::read_blob(&project, &file, &sha)
}

#[tauri::command]
fn repo_state(project: PathBuf) -> Result<RepoState, String> {
    checkpoints::state(&project)
}

#[tauri::command]
fn branch_list(project: PathBuf) -> Result<Branches, String> {
    checkpoints::branches(&project)
}

#[tauri::command]
fn branch_switch(project: PathBuf, name: String) -> Result<(), String> {
    checkpoints::switch_branch(&project, &name)
}

#[tauri::command]
fn branch_create(project: PathBuf, name: String) -> Result<(), String> {
    checkpoints::create_branch(&project, &name)
}

#[tauri::command]
fn branch_track(project: PathBuf, reference: String) -> Result<(), String> {
    checkpoints::track_branch(&project, &reference)
}

#[tauri::command]
fn git_stash(project: PathBuf, label: String) -> Result<bool, String> {
    checkpoints::stash(&project, &label)
}

/// Project-wide search (DESIGN §8.2). Synchronous: the walk is fast enough that
/// streaming results back over events would add complexity for no felt gain.
#[tauri::command]
fn search_project(
    project: PathBuf,
    query: String,
    options: SearchOptions,
) -> Result<SearchOutcome, String> {
    search::search(&project, &query, &options)
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
            system_fonts,
            git_available,
            checkpoint_status,
            checkpoint_create,
            checkpoint_from_content,
            checkpoint_list,
            checkpoint_content,
            repo_state,
            branch_list,
            branch_switch,
            branch_create,
            branch_track,
            git_stash,
            search_project
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
