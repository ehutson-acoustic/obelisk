//! Integration tests for the checkpoint layer, against throwaway repos.
//!
//! This is the one path in the app that can silently destroy the user's
//! writing: a wrong restore looks exactly like a correct one.

use std::fs;
use std::path::Path;
use std::process::Command;

use md_editor_lib::checkpoints::{
    create, create_from_content, list, restore, shadow_dir, status,
};
use tempfile::TempDir;

fn project() -> TempDir {
    TempDir::new().expect("temp dir")
}

fn write(dir: &Path, name: &str, content: &str) -> std::path::PathBuf {
    let path = dir.join(name);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(&path, content).unwrap();
    path
}

fn read(path: &Path) -> String {
    fs::read_to_string(path).unwrap()
}

#[test]
fn creates_the_shadow_repo_on_first_use() {
    let dir = project();
    let file = write(dir.path(), "notes.md", "# One\n");

    status(dir.path(), &file).unwrap();

    assert!(shadow_dir(dir.path()).join("HEAD").exists());
    assert!(shadow_dir(dir.path()).join("info").join("exclude").exists());
}

#[test]
fn reports_new_files_as_changed_and_untracked() {
    let dir = project();
    let file = write(dir.path(), "notes.md", "# One\n");

    let st = status(dir.path(), &file).unwrap();
    assert!(st.changed);
    assert!(!st.tracked);
    assert!(st.diff.is_empty(), "a new file has nothing to diff against");
}

#[test]
fn checkpoint_then_clean_then_dirty_again() {
    let dir = project();
    let file = write(dir.path(), "notes.md", "# One\n");

    assert!(create(dir.path(), &file, "first").unwrap().is_some());

    let st = status(dir.path(), &file).unwrap();
    assert!(!st.changed, "just-committed file should be clean");
    assert!(st.tracked);

    // Nothing changed, so there is nothing to commit.
    assert!(create(dir.path(), &file, "again").unwrap().is_none());

    fs::write(&file, "# One\n\nmore\n").unwrap();
    let st = status(dir.path(), &file).unwrap();
    assert!(st.changed);
    assert!(st.diff.contains("+more"), "diff was: {}", st.diff);
}

#[test]
fn round_trips_content_through_restore() {
    let dir = project();
    let original = "# Original\n\nBody.\n";
    let file = write(dir.path(), "notes.md", original);

    create(dir.path(), &file, "first").unwrap();
    let first = list(dir.path(), &file).unwrap()[0].sha.clone();

    let edited = "# Edited\n\nDifferent body.\n";
    fs::write(&file, edited).unwrap();
    create(dir.path(), &file, "second").unwrap();
    assert_eq!(read(&file), edited);

    restore(dir.path(), &file, &first).unwrap();
    assert_eq!(read(&file), original, "restore must reproduce byte content");

    // History stays linear: the restore is a forward state, and the second
    // checkpoint is still reachable.
    let titles: Vec<_> = list(dir.path(), &file)
        .unwrap()
        .into_iter()
        .map(|c| c.title)
        .collect();
    assert_eq!(titles, vec!["second", "first"]);
}

#[test]
fn restore_leaves_the_file_committable_again() {
    let dir = project();
    let file = write(dir.path(), "notes.md", "v1\n");
    create(dir.path(), &file, "first").unwrap();
    let first = list(dir.path(), &file).unwrap()[0].sha.clone();

    fs::write(&file, "v2\n").unwrap();
    create(dir.path(), &file, "second").unwrap();

    restore(dir.path(), &file, &first).unwrap();

    // The restored content differs from HEAD, so it must be checkpointable.
    assert!(status(dir.path(), &file).unwrap().changed);
    assert!(create(dir.path(), &file, "back to v1").unwrap().is_some());
    assert_eq!(read(&file), "v1\n");
}

/// The core safety promise: Claude overwrites an open file, and the state the
/// editor was showing is still recoverable even though it never hit disk.
#[test]
fn preserves_buffer_content_an_external_write_already_replaced() {
    let dir = project();
    let file = write(dir.path(), "notes.md", "# Mine\n\nMy paragraph.\n");
    create(dir.path(), &file, "first").unwrap();

    // Autosave has written the user's edit to disk, but no checkpoint was
    // taken for it yet — this is the window the trigger exists to cover.
    let in_editor = "# Mine\n\nMy paragraph, edited by me.\n";
    fs::write(&file, in_editor).unwrap();

    // Claude writes over it; the editor buffer still holds `in_editor`.
    fs::write(&file, "# Claude's version\n").unwrap();

    create_from_content(dir.path(), &file, in_editor, "Before external change").unwrap();

    // Disk still has Claude's write — snapshotting must not disturb it.
    assert_eq!(read(&file), "# Claude's version\n");

    let head = list(dir.path(), &file).unwrap()[0].clone();
    assert_eq!(head.title, "Before external change");

    restore(dir.path(), &file, &head.sha).unwrap();
    assert_eq!(read(&file), in_editor, "the lost buffer must come back");
}

#[test]
fn content_checkpoint_skips_identical_content() {
    let dir = project();
    let file = write(dir.path(), "notes.md", "same\n");
    create(dir.path(), &file, "first").unwrap();

    assert!(
        create_from_content(dir.path(), &file, "same\n", "no-op")
            .unwrap()
            .is_none()
    );
    assert!(
        create_from_content(dir.path(), &file, "different\n", "real")
            .unwrap()
            .is_some()
    );
}

#[test]
fn content_checkpoint_works_as_the_very_first_commit() {
    let dir = project();
    let file = write(dir.path(), "notes.md", "on disk\n");

    create_from_content(dir.path(), &file, "in buffer\n", "initial").unwrap();

    let entries = list(dir.path(), &file).unwrap();
    assert_eq!(entries.len(), 1);
    restore(dir.path(), &file, &entries[0].sha).unwrap();
    assert_eq!(read(&file), "in buffer\n");
}

#[test]
fn content_checkpoint_leaves_normal_checkpoints_working() {
    let dir = project();
    let file = write(dir.path(), "notes.md", "v1\n");
    create(dir.path(), &file, "first").unwrap();

    create_from_content(dir.path(), &file, "buffer\n", "snapshot").unwrap();

    // The synthetic commit must not leave junk staged that a later checkpoint
    // would sweep in.
    fs::write(&file, "v2\n").unwrap();
    create(dir.path(), &file, "second").unwrap();

    let titles: Vec<_> = list(dir.path(), &file)
        .unwrap()
        .into_iter()
        .map(|c| c.title)
        .collect();
    assert_eq!(titles, vec!["second", "snapshot", "first"]);
    assert_eq!(read(&file), "v2\n");
}

#[test]
fn history_is_scoped_per_file() {
    let dir = project();
    let a = write(dir.path(), "a.md", "a\n");
    let b = write(dir.path(), "b.md", "b\n");

    create(dir.path(), &a, "commit a").unwrap();
    create(dir.path(), &b, "commit b").unwrap();

    let a_titles: Vec<_> = list(dir.path(), &a)
        .unwrap()
        .into_iter()
        .map(|c| c.title)
        .collect();
    assert_eq!(a_titles, vec!["commit a"]);

    let b_titles: Vec<_> = list(dir.path(), &b)
        .unwrap()
        .into_iter()
        .map(|c| c.title)
        .collect();
    assert_eq!(b_titles, vec!["commit b"]);
}

#[test]
fn commits_only_the_named_file() {
    let dir = project();
    let a = write(dir.path(), "a.md", "a\n");
    write(dir.path(), "b.md", "b\n");

    create(dir.path(), &a, "only a").unwrap();

    let b = dir.path().join("b.md");
    assert!(
        !status(dir.path(), &b).unwrap().tracked,
        "an unrelated file must not be swept into the commit"
    );
}

#[test]
fn handles_files_in_subdirectories() {
    let dir = project();
    let file = write(dir.path(), "docs/deep/notes.md", "# Deep\n");

    create(dir.path(), &file, "nested").unwrap();
    fs::write(&file, "# Changed\n").unwrap();
    let sha = list(dir.path(), &file).unwrap()[0].sha.clone();
    restore(dir.path(), &file, &sha).unwrap();

    assert_eq!(read(&file), "# Deep\n");
}

#[test]
fn never_tracks_its_own_shadow_directory() {
    let dir = project();
    let file = write(dir.path(), "notes.md", "# One\n");
    create(dir.path(), &file, "first").unwrap();

    let tracked = Command::new("git")
        .env("GIT_DIR", shadow_dir(dir.path()))
        .env("GIT_WORK_TREE", dir.path())
        .args(["status", "--porcelain", "--untracked-files=all"])
        .output()
        .unwrap();
    let out = String::from_utf8_lossy(&tracked.stdout);
    assert!(
        !out.contains(".mdeditor"),
        "shadow repo must ignore itself, saw: {out}"
    );
}

#[test]
fn leaves_the_projects_own_repo_untouched() {
    let dir = project();

    // A real repo, as most target folders will be.
    let run = |args: &[&str]| {
        Command::new("git")
            .current_dir(dir.path())
            .args(args)
            .output()
            .unwrap()
    };
    run(&["init", "--quiet"]);
    run(&["config", "user.name", "Real User"]);
    run(&["config", "user.email", "real@example.com"]);

    let file = write(dir.path(), "notes.md", "# One\n");
    run(&["add", "notes.md"]);
    run(&["commit", "--quiet", "-m", "real commit"]);

    fs::write(&file, "# Two\n").unwrap();
    create(dir.path(), &file, "editor checkpoint").unwrap();

    let log = String::from_utf8_lossy(&run(&["log", "--format=%s"]).stdout).into_owned();
    assert!(log.contains("real commit"));
    assert!(
        !log.contains("editor checkpoint"),
        "checkpoints must not enter the user's history, saw: {log}"
    );

    // And the user's index is left alone — their working change is still
    // unstaged, not quietly committed or staged by us.
    let porcelain =
        String::from_utf8_lossy(&run(&["status", "--porcelain", "notes.md"]).stdout).into_owned();
    assert_eq!(porcelain.trim(), "M notes.md");
}
