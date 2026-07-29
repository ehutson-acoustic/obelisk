//! Integration tests for the checkpoint layer, against throwaway repos.
//!
//! This is the one path in the app that can silently destroy the user's
//! writing: a wrong restore looks exactly like a correct one. Since checkpoints
//! moved into the project's own repository (DESIGN §3.1) there is a second
//! class of damage to guard against — disturbing the user's staged work, or
//! committing on top of an operation already in flight — so those get the same
//! treatment as the round-trip tests.

use std::fs;
use std::path::Path;
use std::process::Command;

use obelisk_lib::checkpoints::{
    branches, create, create_branch, create_from_content, list, read_blob, stash, state,
    switch_branch, track_branch,
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

/// Runs git in `dir` and asserts it succeeded, so a broken fixture fails loudly
/// at its own line rather than as a confusing assertion further down.
fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .current_dir(dir)
        .args(args)
        .output()
        .unwrap();
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

/// An explicit branch name and a local identity: the tests must not depend on
/// the developer's `init.defaultBranch` or global `user.email`.
fn init_repo(dir: &Path) {
    git(dir, &["init", "--quiet", "-b", "main"]);
    git(dir, &["config", "user.name", "Real User"]);
    git(dir, &["config", "user.email", "real@example.com"]);
    git(dir, &["config", "commit.gpgsign", "false"]);
}

fn user_commit(dir: &Path, path: &str, message: &str) {
    git(dir, &["add", "--", path]);
    git(dir, &["commit", "--quiet", "-m", message, "--", path]);
}

fn git_dir(dir: &Path) -> std::path::PathBuf {
    std::path::PathBuf::from(git(dir, &["rev-parse", "--absolute-git-dir"]))
}

// ---- commits land in the project's own history ----------------------------

#[test]
fn commits_onto_the_current_branch_of_the_projects_own_repo() {
    let dir = project();
    init_repo(dir.path());
    let file = write(dir.path(), "notes.md", "# One\n");
    user_commit(dir.path(), "notes.md", "real commit");

    fs::write(&file, "# Two\n").unwrap();
    let short = create(dir.path(), &file, "editor checkpoint")
        .unwrap()
        .expect("a change should produce a commit");

    // Visible in the project's own log, on the branch that was checked out.
    let log = git(dir.path(), &["log", "--format=%s", "main"]);
    assert!(log.contains("editor checkpoint"), "log was: {log}");
    assert!(log.contains("real commit"), "log was: {log}");
    assert_eq!(git(dir.path(), &["rev-parse", "--short", "HEAD"]), short);
    assert_eq!(
        git(dir.path(), &["symbolic-ref", "--short", "HEAD"]),
        "main"
    );
}

#[test]
fn carries_the_checkpoint_trailer_and_the_users_identity() {
    let dir = project();
    init_repo(dir.path());
    let file = write(dir.path(), "notes.md", "v1\n");
    create(dir.path(), &file, "mine").unwrap();

    let body = git(dir.path(), &["log", "-1", "--format=%B"]);
    assert!(
        body.contains("Obelisk-Checkpoint: 1"),
        "checkpoints must be identifiable in shared history, saw: {body}"
    );
    assert_eq!(
        git(dir.path(), &["log", "-1", "--format=%an <%ae>"]),
        "Real User <real@example.com>",
        "real commits in real history belong to the user, not the editor"
    );
}

#[test]
fn separates_checkpoints_from_the_users_own_commits() {
    let dir = project();
    init_repo(dir.path());
    let file = write(dir.path(), "notes.md", "v1\n");
    user_commit(dir.path(), "notes.md", "hand written");

    fs::write(&file, "v2\n").unwrap();
    create(dir.path(), &file, "checkpointed").unwrap();

    let entries = list(dir.path(), &file).unwrap();
    let seen: Vec<_> = entries
        .iter()
        .map(|c| (c.title.as_str(), c.checkpoint))
        .collect();
    assert_eq!(
        seen,
        vec![("checkpointed", true), ("hand written", false)],
        "the panel's filter depends on this flag being right"
    );
    assert!(entries.iter().all(|c| c.author == "Real User"));
}

#[test]
fn initializes_a_repo_on_first_checkpoint_when_there_is_none() {
    let dir = project();
    let file = write(dir.path(), "notes.md", "# One\n");

    create(dir.path(), &file, "first").unwrap().unwrap();

    assert!(dir.path().join(".git").exists());
    assert_eq!(list(dir.path(), &file).unwrap().len(), 1);
}

#[test]
fn commits_on_a_branch_that_has_no_commits_yet() {
    let dir = project();
    init_repo(dir.path());
    let file = write(dir.path(), "notes.md", "first ever\n");

    create(dir.path(), &file, "initial").unwrap().unwrap();

    assert_eq!(
        git(dir.path(), &["symbolic-ref", "--short", "HEAD"]),
        "main"
    );
    let entries = list(dir.path(), &file).unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(
        read_blob(dir.path(), &file, &entries[0].sha).unwrap(),
        "first ever\n"
    );
}

// ---- the user's index and working tree are left alone ---------------------

/// The reason a shadow repo existed at all. The scratch-index approach has to
/// make this test pass without one.
#[test]
fn leaves_staged_work_on_other_files_untouched() {
    let dir = project();
    init_repo(dir.path());
    let notes = write(dir.path(), "notes.md", "v1\n");
    write(dir.path(), "code.rs", "fn main() {}\n");
    user_commit(dir.path(), "notes.md", "base");
    user_commit(dir.path(), "code.rs", "base code");

    // Work the user has deliberately staged and not yet committed.
    fs::write(dir.path().join("code.rs"), "fn main() { staged(); }\n").unwrap();
    git(dir.path(), &["add", "--", "code.rs"]);

    fs::write(&notes, "v2\n").unwrap();
    create(dir.path(), &notes, "checkpoint").unwrap().unwrap();

    assert_eq!(
        git(dir.path(), &["show", ":code.rs"]),
        "fn main() { staged(); }",
        "the user's staged version must survive a checkpoint"
    );
    assert_eq!(
        git(dir.path(), &["diff", "--cached", "--name-only"]),
        "code.rs",
        "and it must still be the only thing staged"
    );
    // The checkpoint commit itself carried only the markdown file.
    assert_eq!(
        git(dir.path(), &["show", "--name-only", "--format=", "HEAD"]),
        "notes.md"
    );
}

/// The awkward case: the file being checkpointed is itself staged at some third
/// content. The staged version is superseded rather than preserved — see
/// `sync_index` — and the repo is left in a state git reports honestly, which
/// is the property that actually matters. `status().staged` is how the dialog
/// warns before this happens.
#[test]
fn supersedes_a_staged_version_of_the_file_being_checkpointed() {
    let dir = project();
    init_repo(dir.path());
    let file = write(dir.path(), "notes.md", "v1\n");
    user_commit(dir.path(), "notes.md", "base");

    fs::write(&file, "v2 staged\n").unwrap();
    git(dir.path(), &["add", "--", "notes.md"]);
    fs::write(&file, "v3 in editor\n").unwrap();

    assert!(
        obelisk_lib::checkpoints::status(dir.path(), &file)
            .unwrap()
            .staged,
        "the dialog has to be able to warn about this first"
    );

    create(dir.path(), &file, "checkpoint").unwrap().unwrap();

    assert_eq!(
        git(dir.path(), &["show", "HEAD:notes.md"]),
        "v3 in editor",
        "the checkpoint commits what the editor has"
    );
    assert_eq!(read(&file), "v3 in editor\n", "working tree untouched");
    // The index tracks the commit, so git reports a clean file rather than a
    // phantom staged reversal of it.
    assert_eq!(
        git(dir.path(), &["status", "--porcelain", "--", "notes.md"]),
        "",
        "a stale index entry here is what made `git switch` misbehave"
    );
    assert!(
        !obelisk_lib::checkpoints::status(dir.path(), &file)
            .unwrap()
            .staged
    );
}

#[test]
fn content_checkpoints_never_touch_the_working_tree() {
    let dir = project();
    init_repo(dir.path());
    let file = write(dir.path(), "notes.md", "on disk\n");
    create(dir.path(), &file, "first").unwrap();

    create_from_content(dir.path(), &file, "in buffer\n", "snapshot")
        .unwrap()
        .unwrap();

    assert_eq!(read(&file), "on disk\n");
    assert_eq!(git(dir.path(), &["show", "HEAD:notes.md"]), "in buffer");
}

#[test]
fn removes_its_scratch_index_afterwards() {
    let dir = project();
    init_repo(dir.path());
    let file = write(dir.path(), "notes.md", "v1\n");
    create(dir.path(), &file, "first").unwrap();
    fs::write(&file, "v2\n").unwrap();
    create(dir.path(), &file, "second").unwrap();

    let leftovers: Vec<_> = fs::read_dir(git_dir(dir.path()))
        .unwrap()
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with("obelisk-index"))
        .collect();
    assert!(
        leftovers.is_empty(),
        "scratch indexes must not accumulate in .git, found: {leftovers:?}"
    );
}

// ---- refusals -------------------------------------------------------------

#[test]
fn refuses_to_commit_a_gitignored_file() {
    let dir = project();
    init_repo(dir.path());
    write(dir.path(), ".gitignore", "scratch.md\n");
    user_commit(dir.path(), ".gitignore", "ignore scratch");
    let file = write(dir.path(), "scratch.md", "private\n");

    let err = create(dir.path(), &file, "nope").unwrap_err();
    assert!(
        err.contains("gitignore"),
        "an ignored file must not enter pushable history, got: {err}"
    );
    assert!(
        obelisk_lib::checkpoints::status(dir.path(), &file)
            .unwrap()
            .ignored,
        "and the frontend needs to know so it can disable the button"
    );
}

#[test]
fn refuses_to_commit_while_head_is_detached() {
    let dir = project();
    init_repo(dir.path());
    let file = write(dir.path(), "notes.md", "v1\n");
    user_commit(dir.path(), "notes.md", "one");
    fs::write(&file, "v2\n").unwrap();
    user_commit(dir.path(), "notes.md", "two");

    git(dir.path(), &["checkout", "--quiet", "HEAD~1"]);
    fs::write(&file, "v3\n").unwrap();

    let err = create(dir.path(), &file, "nope").unwrap_err();
    assert!(err.contains("detached"), "got: {err}");
    assert_eq!(
        state(dir.path()).unwrap().blocked.unwrap(),
        "HEAD is detached"
    );
}

#[test]
fn refuses_to_commit_mid_merge_or_rebase() {
    let dir = project();
    init_repo(dir.path());
    let file = write(dir.path(), "notes.md", "v1\n");
    user_commit(dir.path(), "notes.md", "one");
    let git_dir = git_dir(dir.path());

    // The same markers git itself leaves behind, so the guard is tested against
    // the real signal rather than a mock.
    fs::write(git_dir.join("MERGE_HEAD"), "deadbeef\n").unwrap();
    fs::write(&file, "v2\n").unwrap();

    let err = create(dir.path(), &file, "nope").unwrap_err();
    assert!(err.contains("merge is in progress"), "got: {err}");
    assert_eq!(
        state(dir.path()).unwrap().blocked.unwrap(),
        "a merge is in progress"
    );

    fs::remove_file(git_dir.join("MERGE_HEAD")).unwrap();
    fs::create_dir_all(git_dir.join("rebase-merge")).unwrap();
    let err = create(dir.path(), &file, "nope").unwrap_err();
    assert!(err.contains("rebase is in progress"), "got: {err}");
}

#[test]
fn reports_a_clean_state_when_nothing_is_in_flight() {
    let dir = project();
    init_repo(dir.path());
    write(dir.path(), "notes.md", "v1\n");
    user_commit(dir.path(), "notes.md", "one");

    let st = state(dir.path()).unwrap();
    assert!(st.repo);
    assert_eq!(st.branch.as_deref(), Some("main"));
    assert!(st.head.is_some());
    assert!(st.blocked.is_none());

    // And a folder with no repo says so rather than erroring.
    let bare = project();
    let st = state(bare.path()).unwrap();
    assert!(!st.repo);
    assert_eq!(st.blocked.as_deref(), Some("not a git repository"));
    assert!(list(bare.path(), &write(bare.path(), "a.md", "x"))
        .unwrap()
        .is_empty());
}

// ---- restore --------------------------------------------------------------

#[test]
fn round_trips_content_through_restore() {
    let dir = project();
    init_repo(dir.path());
    let original = "# Original\n\nBody with ünicode and a tab\there.\n";
    let file = write(dir.path(), "notes.md", original);

    create(dir.path(), &file, "first").unwrap();
    let first = list(dir.path(), &file).unwrap()[0].sha.clone();

    let edited = "# Edited\n\nDifferent body.\n";
    fs::write(&file, edited).unwrap();
    create(dir.path(), &file, "second").unwrap();

    assert_eq!(
        read_blob(dir.path(), &file, &first).unwrap(),
        original,
        "restore must reproduce byte content exactly"
    );
    // Reading a version does not disturb the working tree or the index — the
    // frontend performs the write itself.
    assert_eq!(read(&file), edited);
    assert_eq!(git(dir.path(), &["diff", "--cached", "--name-only"]), "");
}

#[test]
fn restores_from_a_commit_the_editor_did_not_make() {
    let dir = project();
    init_repo(dir.path());
    let file = write(dir.path(), "notes.md", "hand written v1\n");
    user_commit(dir.path(), "notes.md", "by hand");
    let sha = list(dir.path(), &file).unwrap()[0].sha.clone();

    fs::write(&file, "later\n").unwrap();
    create(dir.path(), &file, "checkpoint").unwrap();

    assert_eq!(
        read_blob(dir.path(), &file, &sha).unwrap(),
        "hand written v1\n",
        "the whole point of one shared history is reaching the user's own commits"
    );
}

/// The core safety promise: Claude overwrites an open file, and the state the
/// editor was showing is still recoverable even though it never hit disk.
#[test]
fn preserves_buffer_content_an_external_write_already_replaced() {
    let dir = project();
    init_repo(dir.path());
    let file = write(dir.path(), "notes.md", "# Mine\n\nMy paragraph.\n");
    create(dir.path(), &file, "first").unwrap();

    // Autosave has written the user's edit to disk, but no checkpoint was taken
    // for it yet — this is the window the trigger exists to cover.
    let in_editor = "# Mine\n\nMy paragraph, edited by me.\n";
    fs::write(&file, in_editor).unwrap();

    // Claude writes over it; the editor buffer still holds `in_editor`.
    fs::write(&file, "# Claude's version\n").unwrap();

    create_from_content(dir.path(), &file, in_editor, "Before external change").unwrap();

    // Disk still has Claude's write — snapshotting must not disturb it.
    assert_eq!(read(&file), "# Claude's version\n");

    let head = list(dir.path(), &file).unwrap()[0].clone();
    assert_eq!(head.title, "Before external change");
    assert_eq!(
        read_blob(dir.path(), &file, &head.sha).unwrap(),
        in_editor,
        "the lost buffer must come back"
    );
}

#[test]
fn content_checkpoint_skips_identical_content() {
    let dir = project();
    init_repo(dir.path());
    let file = write(dir.path(), "notes.md", "same\n");
    create(dir.path(), &file, "first").unwrap();

    assert!(create_from_content(dir.path(), &file, "same\n", "no-op")
        .unwrap()
        .is_none());
    assert!(
        create_from_content(dir.path(), &file, "different\n", "real")
            .unwrap()
            .is_some()
    );
}

#[test]
fn checkpoint_then_clean_then_dirty_again() {
    let dir = project();
    init_repo(dir.path());
    let file = write(dir.path(), "notes.md", "# One\n");

    assert!(create(dir.path(), &file, "first").unwrap().is_some());

    let st = obelisk_lib::checkpoints::status(dir.path(), &file).unwrap();
    assert!(!st.changed, "just-committed file should be clean");
    assert!(st.tracked);
    assert!(!st.ignored);

    assert!(create(dir.path(), &file, "again").unwrap().is_none());

    fs::write(&file, "# One\n\nmore\n").unwrap();
    let st = obelisk_lib::checkpoints::status(dir.path(), &file).unwrap();
    assert!(st.changed);
    assert!(st.diff.contains("+more"), "diff was: {}", st.diff);
}

// ---- path handling --------------------------------------------------------

#[test]
fn handles_files_in_subdirectories() {
    let dir = project();
    init_repo(dir.path());
    let file = write(dir.path(), "docs/deep/notes.md", "# Deep\n");

    create(dir.path(), &file, "nested").unwrap();
    let sha = list(dir.path(), &file).unwrap()[0].sha.clone();

    assert_eq!(read_blob(dir.path(), &file, &sha).unwrap(), "# Deep\n");
    assert_eq!(
        git(dir.path(), &["show", "--name-only", "--format=", "HEAD"]),
        "docs/deep/notes.md"
    );
}

/// A project folder can be a subdirectory of the repository. Paths have to
/// resolve against the repo root, not the project, or every `HEAD:<path>`
/// lookup addresses a tree that does not contain the file.
#[test]
fn works_when_the_project_is_a_subdirectory_of_the_repo() {
    let dir = project();
    init_repo(dir.path());
    let sub = dir.path().join("notebook");
    fs::create_dir_all(&sub).unwrap();
    let file = write(&sub, "notes.md", "v1\n");

    create(&sub, &file, "first").unwrap().unwrap();

    assert_eq!(
        git(dir.path(), &["show", "--name-only", "--format=", "HEAD"]),
        "notebook/notes.md"
    );
    assert_eq!(list(&sub, &file).unwrap().len(), 1);
    assert!(
        fs::metadata(sub.join(".git")).is_err(),
        "must not init a nested repo"
    );
}

/// Regression: git resolves pathspecs against the process working directory,
/// not the work tree. `pnpm tauri dev` launches the binary from `src-tauri`,
/// so when the project being edited *is* the app's own repo, every `-- <file>`
/// argument silently matched nothing: no changes detected, no history listed,
/// no periodic checkpoints.
#[test]
fn works_when_the_process_cwd_is_inside_the_project() {
    let dir = project();
    init_repo(dir.path());
    let sub = dir.path().join("src-tauri");
    fs::create_dir_all(&sub).unwrap();
    let file = write(dir.path(), "notes.md", "v1\n");

    let original_cwd = std::env::current_dir().unwrap();
    std::env::set_current_dir(&sub).unwrap();

    let outcome = (|| {
        create(dir.path(), &file, "first")?;
        fs::write(&file, "v2 changed\n").unwrap();
        let st = obelisk_lib::checkpoints::status(dir.path(), &file)?;
        let entries = list(dir.path(), &file)?;
        Ok::<_, String>((st, entries))
    })();

    std::env::set_current_dir(original_cwd).unwrap();
    let (st, entries) = outcome.expect("checkpoint ops from a nested cwd");

    assert!(st.changed, "the edit must be visible from a nested cwd");
    assert_eq!(entries.len(), 1, "history must be visible from any cwd");
    assert_eq!(entries[0].title, "first");
}

#[test]
fn history_is_scoped_per_file() {
    let dir = project();
    init_repo(dir.path());
    let a = write(dir.path(), "a.md", "a\n");
    let b = write(dir.path(), "b.md", "b\n");

    create(dir.path(), &a, "commit a").unwrap();
    create(dir.path(), &b, "commit b").unwrap();

    let titles = |file: &Path| -> Vec<String> {
        list(dir.path(), file)
            .unwrap()
            .into_iter()
            .map(|c| c.title)
            .collect()
    };
    assert_eq!(titles(&a), vec!["commit a"]);
    assert_eq!(titles(&b), vec!["commit b"]);
}

#[test]
fn commits_only_the_named_file() {
    let dir = project();
    init_repo(dir.path());
    let a = write(dir.path(), "a.md", "a\n");
    write(dir.path(), "b.md", "b\n");

    create(dir.path(), &a, "only a").unwrap();

    let b = dir.path().join("b.md");
    assert!(
        !obelisk_lib::checkpoints::status(dir.path(), &b)
            .unwrap()
            .tracked,
        "an unrelated file must not be swept into the commit"
    );
}

// ---- branches -------------------------------------------------------------

#[test]
fn lists_local_branches_with_the_current_and_default_marked() {
    let dir = project();
    init_repo(dir.path());
    write(dir.path(), "notes.md", "v1\n");
    user_commit(dir.path(), "notes.md", "one");
    git(dir.path(), &["branch", "topic"]);

    let b = branches(dir.path()).unwrap();
    assert_eq!(b.local, vec!["main", "topic"]);
    assert_eq!(b.current.as_deref(), Some("main"));
    assert_eq!(b.default_branch.as_deref(), Some("main"));
    assert!(b.remote.is_empty());
}

#[test]
fn lists_only_remote_branches_without_a_local_counterpart() {
    let dir = project();
    init_repo(dir.path());
    write(dir.path(), "notes.md", "v1\n");
    user_commit(dir.path(), "notes.md", "one");
    let head = git(dir.path(), &["rev-parse", "HEAD"]);

    git(
        dir.path(),
        &["remote", "add", "origin", "https://example.invalid/r.git"],
    );
    // Remote-tracking refs as a fetch would leave them, without the network.
    git(
        dir.path(),
        &["update-ref", "refs/remotes/origin/main", &head],
    );
    git(
        dir.path(),
        &["update-ref", "refs/remotes/origin/colleague", &head],
    );
    git(
        dir.path(),
        &[
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/main",
        ],
    );

    let b = branches(dir.path()).unwrap();
    assert_eq!(
        b.remote.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(),
        vec!["colleague"],
        "origin/main duplicates the local branch and origin/HEAD is an alias"
    );
    assert_eq!(b.remote[0].reference, "origin/colleague");
    assert_eq!(b.default_branch.as_deref(), Some("main"));
}

#[test]
fn creates_switches_and_tracks_branches() {
    let dir = project();
    init_repo(dir.path());
    let file = write(dir.path(), "notes.md", "v1\n");
    user_commit(dir.path(), "notes.md", "one");
    let head = git(dir.path(), &["rev-parse", "HEAD"]);

    create_branch(dir.path(), "topic").unwrap();
    assert_eq!(
        branches(dir.path()).unwrap().current.as_deref(),
        Some("topic")
    );

    // A checkpoint on the new branch advances that branch, not the old one.
    fs::write(&file, "on topic\n").unwrap();
    create(dir.path(), &file, "topic work").unwrap();
    assert_eq!(git(dir.path(), &["show", "topic:notes.md"]), "on topic");
    assert_eq!(git(dir.path(), &["show", "main:notes.md"]), "v1");

    switch_branch(dir.path(), "main").unwrap();
    assert_eq!(
        branches(dir.path()).unwrap().current.as_deref(),
        Some("main")
    );
    assert_eq!(read(&file), "v1\n", "the switch rewrote the working tree");

    git(
        dir.path(),
        &["remote", "add", "origin", "https://example.invalid/r.git"],
    );
    git(
        dir.path(),
        &["update-ref", "refs/remotes/origin/colleague", &head],
    );
    track_branch(dir.path(), "origin/colleague").unwrap();
    assert_eq!(
        branches(dir.path()).unwrap().current.as_deref(),
        Some("colleague")
    );
    assert_eq!(
        git(dir.path(), &["config", "branch.colleague.remote"]),
        "origin",
        "picking a remote branch should set up tracking"
    );
}

#[test]
fn rejects_branch_names_git_would_not_accept() {
    let dir = project();
    init_repo(dir.path());
    write(dir.path(), "notes.md", "v1\n");
    user_commit(dir.path(), "notes.md", "one");

    for name in ["", "-force", "bad..name", "has space", "ends/"] {
        assert!(
            create_branch(dir.path(), name).is_err(),
            "{name:?} must be rejected before it reaches git"
        );
    }
}

#[test]
fn surfaces_gits_refusal_when_a_switch_would_lose_work() {
    let dir = project();
    init_repo(dir.path());
    let file = write(dir.path(), "notes.md", "on main\n");
    user_commit(dir.path(), "notes.md", "one");

    create_branch(dir.path(), "topic").unwrap();
    fs::write(&file, "different on topic\n").unwrap();
    user_commit(dir.path(), "notes.md", "topic version");

    // An uncommitted edit that switching back would have to overwrite.
    fs::write(&file, "work in progress\n").unwrap();
    let err = switch_branch(dir.path(), "main").unwrap_err();
    assert!(
        err.contains("notes.md"),
        "git's own explanation is what the dropdown shows, got: {err}"
    );

    // Stashing clears the way, and the switch then succeeds.
    assert!(stash(dir.path(), "main").unwrap());
    switch_branch(dir.path(), "main").unwrap();
    assert_eq!(read(&file), "on main\n");
    assert!(
        git(dir.path(), &["stash", "list", "--format=%gs"]).contains("before switching to main")
    );
}

#[test]
fn stashing_reports_when_there_was_nothing_to_stash() {
    let dir = project();
    init_repo(dir.path());
    write(dir.path(), "notes.md", "v1\n");
    user_commit(dir.path(), "notes.md", "one");

    assert!(
        !stash(dir.path(), "main").unwrap(),
        "a clean tree must not produce a stash entry"
    );
    assert_eq!(git(dir.path(), &["stash", "list"]), "");
}

/// Untracked files are never stashed: `git switch` does not refuse because of
/// them, so sweeping them away would remove work — possibly a file Claude had
/// just written — for no reason.
#[test]
fn stashing_leaves_untracked_files_in_place() {
    let dir = project();
    init_repo(dir.path());
    let tracked = write(dir.path(), "notes.md", "v1\n");
    user_commit(dir.path(), "notes.md", "one");
    fs::write(&tracked, "v2\n").unwrap();
    write(dir.path(), "brand-new.md", "written by claude\n");

    assert!(stash(dir.path(), "main").unwrap());

    assert_eq!(read(&tracked), "v1\n", "tracked change was stashed");
    assert_eq!(
        read(&dir.path().join("brand-new.md")),
        "written by claude\n",
        "untracked file must survive"
    );
}
