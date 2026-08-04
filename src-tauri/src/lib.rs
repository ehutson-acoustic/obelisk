pub mod associations;
pub mod checkpoints;
pub mod search;

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use checkpoints::{Branches, Checkpoint, CheckpointStatus, RepoState};
use search::{SearchOptions, SearchOutcome};
use tauri::{AppHandle, Emitter, Manager, State};

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

// ---- files opened from the OS (DESIGN §10.1) -------------------------------

/// Event carrying paths to a webview that is already up. Its twin is
/// `OPEN_FILES_EVENT` in `src/lib/openRequests.ts`.
const OPEN_FILES_EVENT: &str = "obelisk://open-files";

/// Files the OS asked us to open, held until the webview can take them.
///
/// A double-clicked file arrives long before the frontend exists — on macOS
/// through `RunEvent::Opened`, on Linux in `argv` — so the paths have to survive
/// the gap. `ready` flips on the frontend's first drain, after which later opens
/// go straight out as an event instead of accumulating unread.
#[derive(Default)]
struct OpenRequests {
    paths: Mutex<Vec<String>>,
    ready: AtomicBool,
}

/// Hands paths to the frontend if it is listening, queues them if it is not.
fn queue_opens(app: &AppHandle, paths: Vec<PathBuf>) {
    let paths: Vec<String> = paths
        .into_iter()
        // A stale path from a `%F` the desktop entry never substituted, or a
        // directory dropped on the icon, would otherwise open an empty tab.
        .filter(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned())
        .collect();
    if paths.is_empty() {
        return;
    }

    let state = app.state::<OpenRequests>();
    if state.ready.load(Ordering::SeqCst) {
        let _ = app.emit(OPEN_FILES_EVENT, &paths);
    } else if let Ok(mut queue) = state.paths.lock() {
        queue.extend(paths);
    }

    // Linux hands a second launch to the instance already running, which stays
    // buried behind whatever has focus unless it raises itself. macOS does this
    // for us, and calling it there is harmless.
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }
}

/// Drains the queue, and in doing so declares the webview ready — so this is
/// also what switches `queue_opens` over to emitting.
#[tauri::command]
fn take_open_requests(state: State<'_, OpenRequests>) -> Vec<String> {
    state.ready.store(true, Ordering::SeqCst);
    state
        .paths
        .lock()
        .map(|mut queue| std::mem::take(&mut *queue))
        .unwrap_or_default()
}

/// Directory to adopt as the project for a file opened from outside the app.
///
/// The repo root when there is one, because that is the directory every other
/// part of the app assumes a project is (DESIGN §3.1) — pathspecs, the file
/// browser and `.obelisk/settings.json` all resolve against it. The containing
/// directory otherwise.
#[tauri::command]
fn project_dir_for(file: PathBuf) -> Option<String> {
    let parent = file.parent()?;
    let dir = checkpoints::repo_root(parent).unwrap_or_else(|| parent.to_path_buf());
    Some(dir.to_string_lossy().into_owned())
}

/// Whether Obelisk holds the system's Markdown binding (DESIGN §10.2).
#[tauri::command]
fn default_editor_state(app: AppHandle) -> associations::DefaultEditorState {
    associations::state(&app.config().identifier)
}

/// Claims the binding, then reports the state that actually resulted rather than
/// the one we asked for — the OS is entitled to refuse, and on Linux the write
/// goes through a helper that may not be installed.
#[tauri::command]
fn set_default_editor(app: AppHandle) -> Result<associations::DefaultEditorState, String> {
    let bundle_id = app.config().identifier.clone();
    associations::make_default(&bundle_id)?;
    Ok(associations::state(&bundle_id))
}

/// Paths from the command line — how Linux delivers a file click, and what
/// `open -a Obelisk file.md` reaches us with on macOS.
///
/// Flags are dropped because the webview adds its own, and so is a literal `%F`
/// or `%U`, which is what a desktop entry passes through when it was launched
/// with no file to substitute.
fn paths_from_args<I: IntoIterator<Item = String>>(args: I) -> Vec<PathBuf> {
    args.into_iter()
        .skip(1)
        .filter(|arg| !arg.starts_with('-') && !arg.starts_with('%'))
        .map(PathBuf::from)
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Linux-only, and first in the chain as the plugin requires. macOS reuses
    // the running app and re-fires `RunEvent::Opened`, but a second Linux launch
    // is a whole new process that has to hand its argv over and exit.
    #[cfg(target_os = "linux")]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
        queue_opens(app, paths_from_args(argv));
    }));

    let app = builder
        .manage(OpenRequests::default())
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
            search_project,
            take_open_requests,
            project_dir_for,
            default_editor_state,
            set_default_editor
        ])
        // `build` rather than `run`, because the file the user double-clicked
        // reaches us as a run event and `run(context)` discards the callback.
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    queue_opens(app.handle(), paths_from_args(std::env::args()));

    app.run(|_app, _event| {
        // macOS delivers a file click as an Apple event, not on the command
        // line, and `RunEvent::Opened` is the only place it surfaces.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Opened { urls } = &_event {
            let paths = urls.iter().filter_map(|url| url.to_file_path().ok());
            queue_opens(_app, paths.collect());
        }
    });
}
