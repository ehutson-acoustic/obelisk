//! Checkpoints as commits in the project's **own** git repository (DESIGN §3).
//!
//! This replaces an earlier shadow repo at `.obelisk/git`. Two things made that
//! reversal safe to do, and both are load-bearing here:
//!
//! * Every commit is built through a **scratch index** (`GIT_INDEX_FILE`), never
//!   `git add`, so staged work on every *other* path survives untouched. The
//!   real index is then updated for the checkpointed path alone — see
//!   `sync_index` for why leaving it stale is not an option.
//! * Committing is **refused outright** in states where advancing a branch would
//!   corrupt an operation already in flight — detached HEAD, rebase, merge,
//!   cherry-pick, revert, bisect.
//!
//! Because these are now real commits in real history, two further rules apply
//! that the shadow repo did not need: gitignored files are never committed, and
//! commits are never signed (a passphrase prompt would block an autosave).
//!
//! Commits are made with `commit-tree`, which does not run hooks — a checkpoint
//! deliberately bypasses `pre-commit`/`commit-msg`.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;

/// Trailer marking a commit as the editor's own, so the versions list can tell
/// checkpoints apart from the user's commits now that both share one history.
const TRAILER: &str = "Obelisk-Checkpoint";

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct Checkpoint {
    pub sha: String,
    pub short: String,
    pub title: String,
    /// Commit time, seconds since the epoch.
    pub timestamp: i64,
    pub author: String,
    /// Carries the `Obelisk-Checkpoint` trailer, i.e. the editor made it.
    pub checkpoint: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct CheckpointStatus {
    /// The file differs from HEAD, or is not in HEAD at all.
    pub changed: bool,
    /// The file exists in HEAD.
    pub tracked: bool,
    /// Unified diff against HEAD; empty when untracked or unchanged.
    pub diff: String,
    /// Excluded by a gitignore rule. Committing it would put a file the user
    /// deliberately untracked into their history, so checkpointing is refused.
    pub ignored: bool,
    /// The user has staged a version of this file that differs from HEAD. A
    /// checkpoint supersedes it (see `sync_index`), so the dialog warns first.
    pub staged: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct RepoState {
    /// The project resolves to a git repository.
    pub repo: bool,
    /// Current branch, or `None` while HEAD is detached.
    pub branch: Option<String>,
    /// Short HEAD sha; `None` on a branch with no commits yet.
    pub head: Option<String>,
    /// Why checkpointing is unavailable right now, for the button's tooltip.
    /// `None` means it is safe.
    pub blocked: Option<String>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct RemoteBranch {
    /// Full remote-tracking ref, e.g. `origin/feature`.
    pub reference: String,
    /// Local branch `--track` would create, e.g. `feature`.
    pub name: String,
}

#[derive(Debug, Serialize, Clone, PartialEq, Default)]
pub struct Branches {
    pub current: Option<String>,
    pub default_branch: Option<String>,
    pub local: Vec<String>,
    /// Remote-tracking branches with no local counterpart.
    pub remote: Vec<RemoteBranch>,
}

// ---- process plumbing ------------------------------------------------------

fn command(dir: &Path, index: Option<&Path>) -> Command {
    let mut cmd = Command::new("git");
    // Pathspecs resolve against the process working directory, not the work
    // tree, so this has to be the repo root. `pnpm tauri dev` launches the
    // binary from `src-tauri`, which silently made every `-- <file>` argument
    // match nothing when the project being edited was the app's own repo.
    cmd.current_dir(dir);
    if let Some(index) = index {
        cmd.env("GIT_INDEX_FILE", index);
    }
    cmd
}

fn output(dir: &Path, index: Option<&Path>, args: &[&str]) -> Result<std::process::Output, String> {
    command(dir, index)
        .args(args)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))
}

fn checked(
    dir: &Path,
    index: Option<&Path>,
    args: &[&str],
) -> Result<std::process::Output, String> {
    let out = output(dir, index, args)?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        return Err(if err.is_empty() {
            format!("git {} failed", args.join(" "))
        } else {
            err
        });
    }
    Ok(out)
}

fn git_in(dir: &Path, index: Option<&Path>, args: &[&str]) -> Result<String, String> {
    Ok(String::from_utf8_lossy(&checked(dir, index, args)?.stdout).into_owned())
}

fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    git_in(dir, None, args)
}

/// Exit status only, for the several git commands that answer a question by
/// succeeding or failing rather than by printing.
fn git_ok(dir: &Path, args: &[&str]) -> bool {
    output(dir, None, args)
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn git_stdin(dir: &Path, args: &[&str], input: &[u8]) -> Result<String, String> {
    let mut child = command(dir, None)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to run git: {e}"))?;

    child
        .stdin
        .take()
        .ok_or("no stdin")?
        .write_all(input)
        .map_err(|e| e.to_string())?;

    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

pub fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

// ---- repository resolution -------------------------------------------------

/// Root of the repository containing `project`, which is not always `project`
/// itself — opening a subdirectory of a repo has to resolve upward, or every
/// `HEAD:<path>` lookup addresses the wrong tree.
pub fn repo_root(project: &Path) -> Option<PathBuf> {
    let out = git(project, &["rev-parse", "--show-toplevel"]).ok()?;
    let trimmed = out.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed))
    }
}

fn git_dir(root: &Path) -> Result<PathBuf, String> {
    Ok(PathBuf::from(
        git(root, &["rev-parse", "--absolute-git-dir"])?.trim(),
    ))
}

/// DESIGN §3.1 — the project's own repository, created on demand by the first
/// checkpoint.
pub fn ensure_repo(project: &Path) -> Result<PathBuf, String> {
    if let Some(root) = repo_root(project) {
        return Ok(root);
    }
    git(project, &["init", "--quiet"])?;
    repo_root(project).ok_or_else(|| "git init did not produce a repository".to_string())
}

/// `canonicalize` fails on a path that does not exist yet, which a file being
/// checkpointed from an editor buffer legitimately may not.
fn canonical(path: &Path) -> PathBuf {
    if let Ok(resolved) = path.canonicalize() {
        return resolved;
    }
    match (path.parent(), path.file_name()) {
        (Some(parent), Some(name)) => match parent.canonicalize() {
            Ok(resolved) => resolved.join(name),
            Err(_) => path.to_path_buf(),
        },
        _ => path.to_path_buf(),
    }
}

/// Path of `file` relative to the repo root, in git's forward-slash form. Both
/// sides are canonicalized because the repo root comes back from git already
/// resolved, while the frontend's path may still run through a symlink — on
/// macOS `/var` versus `/private/var` alone is enough to break the prefix.
fn relative(root: &Path, file: &Path) -> Result<String, String> {
    let root = canonical(root);
    let file = canonical(file);
    let rel = file
        .strip_prefix(&root)
        .map_err(|_| format!("{} is outside the repository", file.display()))?;
    Ok(rel.to_string_lossy().replace('\\', "/"))
}

// ---- guards ----------------------------------------------------------------

/// States where committing on top of HEAD would corrupt an operation the user
/// is in the middle of. The frontend disables the Checkpoint button on these.
fn in_progress(git_dir: &Path) -> Option<String> {
    const MARKERS: &[(&str, &str)] = &[
        ("rebase-merge", "a rebase is in progress"),
        ("rebase-apply", "a rebase is in progress"),
        ("MERGE_HEAD", "a merge is in progress"),
        ("CHERRY_PICK_HEAD", "a cherry-pick is in progress"),
        ("REVERT_HEAD", "a revert is in progress"),
        ("BISECT_LOG", "a bisect is in progress"),
    ];
    MARKERS
        .iter()
        .find(|(marker, _)| git_dir.join(marker).exists())
        .map(|(_, reason)| (*reason).to_string())
}

/// The shadow repo made committing a gitignored file harmless. The project's
/// own repo does not: it would put a file the user deliberately untracked into
/// history that gets pushed.
fn guard_ignored(root: &Path, rel: &str) -> Result<(), String> {
    // check-ignore reports nothing for a tracked path, so a file that is both
    // tracked and matched by a rule stays checkpointable, as it should.
    if git_ok(root, &["check-ignore", "--quiet", "--", rel]) {
        return Err(format!("{rel} is excluded by .gitignore"));
    }
    Ok(())
}

/// `commit-tree` refuses without a committer identity. A user who has never
/// configured git would otherwise hit an opaque failure on their first
/// checkpoint. Their own identity is always preferred — these are real commits
/// in real history, so they should not be attributed to the editor.
fn identity_args(root: &Path) -> Vec<String> {
    if git(root, &["var", "GIT_COMMITTER_IDENT"]).is_ok() {
        return Vec::new();
    }
    vec![
        "-c".into(),
        "user.name=Obelisk".into(),
        "-c".into(),
        "user.email=obelisk@localhost".into(),
    ]
}

pub fn state(project: &Path) -> Result<RepoState, String> {
    let Some(root) = repo_root(project) else {
        return Ok(RepoState {
            repo: false,
            branch: None,
            head: None,
            blocked: Some("not a git repository".into()),
        });
    };
    let git_dir = git_dir(&root)?;

    let branch = git(&root, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let head = git(&root, &["rev-parse", "--short", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let blocked = if branch.is_none() {
        Some("HEAD is detached".into())
    } else {
        in_progress(&git_dir)
    };

    Ok(RepoState {
        repo: true,
        branch,
        head,
        blocked,
    })
}

fn blob_at(root: &Path, spec: &str) -> Option<String> {
    git(root, &["rev-parse", "--verify", "--quiet", spec])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Blob id the file's current bytes would produce, without writing an object.
fn disk_blob(root: &Path, file: &Path) -> Option<String> {
    let bytes = std::fs::read(file).ok()?;
    git_stdin(root, &["hash-object", "--stdin"], &bytes)
        .ok()
        .map(|s| s.trim().to_string())
}

pub fn status(project: &Path, file: &Path) -> Result<CheckpointStatus, String> {
    let Some(root) = repo_root(project) else {
        // No repo yet — the first checkpoint creates one, so report the file as
        // worth committing rather than pretending nothing changed.
        return Ok(CheckpointStatus {
            changed: file.exists(),
            tracked: false,
            diff: String::new(),
            ignored: false,
            staged: false,
        });
    };
    let rel = relative(&root, file)?;

    let ignored = git_ok(&root, &["check-ignore", "--quiet", "--", &rel]);
    let head = blob_at(&root, &format!("HEAD:{rel}"));
    let tracked = head.is_some();

    // Compared blob-to-blob rather than via `git diff`, which reads through the
    // index and would therefore report a file as *deleted* whenever the index
    // lacks an entry HEAD has. What a checkpoint cares about is only whether
    // the bytes on disk differ from the committed ones.
    let changed = match (&head, disk_blob(&root, file)) {
        (Some(committed), Some(on_disk)) => committed != &on_disk,
        // Present in HEAD but gone from disk, or new and not yet committed.
        (Some(_), None) | (None, Some(_)) => true,
        (None, None) => false,
    };

    let staged = match (&head, blob_at(&root, &format!(":{rel}"))) {
        (committed, Some(index)) => committed.as_deref() != Some(index.as_str()),
        (Some(_), None) => true,
        (None, None) => false,
    };

    let diff = if tracked {
        git(&root, &["diff", "--no-color", "HEAD", "--", &rel]).unwrap_or_default()
    } else {
        String::new()
    };

    Ok(CheckpointStatus {
        changed,
        tracked,
        diff,
        ignored,
        staged,
    })
}

// ---- creating checkpoints --------------------------------------------------

/// Unique per call: the periodic timer can fire while a manual checkpoint is
/// still in flight, and a shared scratch index would let each write the other's
/// tree.
fn temp_index(git_dir: &Path) -> PathBuf {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    git_dir.join(format!("obelisk-index-{}-{n}", std::process::id()))
}

/// Markdown is never executable, but a checkpoint must not silently chmod the
/// file it is preserving. Only the executable bit is carried over; anything
/// else (a symlink, say) is treated as a regular file rather than having its
/// mode guessed.
fn blob_mode(root: &Path, rel: &str, has_head: bool) -> &'static str {
    if has_head {
        if let Ok(out) = git(root, &["ls-tree", "HEAD", "--", rel]) {
            if out.split_whitespace().next() == Some("100755") {
                return "100755";
            }
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(root.join(rel)) {
            if meta.permissions().mode() & 0o111 != 0 {
                return "100755";
            }
        }
    }
    "100644"
}

/// Commits HEAD's tree with `rel` replaced by `blob`, advancing the current
/// branch. Returns `None` when `blob` is already what HEAD holds.
///
/// The tree is assembled in a scratch index, so staged work on every other path
/// is left exactly as it was. Only this path's real index entry is moved
/// afterwards, and only because it has to be — see `sync_index`.
fn commit_blob(
    root: &Path,
    rel: &str,
    blob: &str,
    message: &str,
) -> Result<Option<String>, String> {
    let git_dir = git_dir(root)?;
    if let Some(reason) = in_progress(&git_dir) {
        return Err(format!("cannot checkpoint while {reason}"));
    }

    // Resolved rather than using HEAD directly, because the ref is what gets
    // advanced and a detached HEAD has none to advance.
    let head_ref = git(root, &["symbolic-ref", "--quiet", "HEAD"])
        .map_err(|_| "cannot checkpoint while HEAD is detached".to_string())?
        .trim()
        .to_string();

    let has_head = git_ok(root, &["rev-parse", "--verify", "--quiet", "HEAD"]);
    let head_sha = if has_head {
        git(root, &["rev-parse", "HEAD"])?.trim().to_string()
    } else {
        String::new()
    };

    if has_head {
        if let Ok(existing) = git(root, &["rev-parse", &format!("HEAD:{rel}")]) {
            if existing.trim() == blob {
                return Ok(None);
            }
        }
    }

    let mode = blob_mode(root, rel, has_head);
    let cacheinfo = format!("{mode},{blob},{rel}");

    let index = temp_index(&git_dir);
    let result = (|| -> Result<String, String> {
        if has_head {
            git_in(root, Some(&index), &["read-tree", "HEAD"])?;
        } else {
            git_in(root, Some(&index), &["read-tree", "--empty"])?;
        }
        git_in(
            root,
            Some(&index),
            &["update-index", "--add", "--cacheinfo", &cacheinfo],
        )?;
        let tree = git_in(root, Some(&index), &["write-tree"])?
            .trim()
            .to_string();

        let title = if message.trim().is_empty() {
            "Checkpoint"
        } else {
            message.trim()
        };

        let mut args = identity_args(root);
        args.push("commit-tree".into());
        args.push(tree);
        if has_head {
            args.push("-p".into());
            args.push(head_sha.clone());
        }
        args.push("-m".into());
        args.push(title.to_string());
        args.push("-m".into());
        args.push(format!("{TRAILER}: 1"));
        let borrowed: Vec<&str> = args.iter().map(String::as_str).collect();
        let commit = git(root, &borrowed)?.trim().to_string();

        // The old value is passed so a concurrent update loses instead of being
        // silently overwritten; an empty old value asserts the ref is unborn.
        git(
            root,
            &[
                "update-ref",
                "-m",
                "obelisk: checkpoint",
                &head_ref,
                &commit,
                &head_sha,
            ],
        )?;

        sync_index(root, &cacheinfo);

        Ok(git(root, &["rev-parse", "--short", &commit])?
            .trim()
            .to_string())
    })();

    let _ = std::fs::remove_file(&index);
    result.map(Some)
}

/// Points the *real* index at the blob just committed, for this path only.
///
/// Skipping this was the original plan and it does not work: the index would go
/// on holding the pre-checkpoint blob, so `git status` reports a staged
/// *reversal* of the file and the next `git commit` would undo the checkpoint.
/// A two-way `git switch` reads the index too, and gets the wrong answer about
/// what the file currently is.
///
/// The cost is that a version of this same file the user had staged is
/// superseded — its blob survives in the object database but nothing references
/// it. `CheckpointStatus::staged` exists so the dialog can say so beforehand.
/// Refusing to checkpoint instead was rejected: the pre-external-write trigger
/// is the one that rescues unsaved writing, and it must never decline.
fn sync_index(root: &Path, cacheinfo: &str) {
    // Best-effort: the commit already exists by this point, so failing here is
    // not worth turning a successful checkpoint into an error.
    let _ = git(root, &["update-index", "--add", "--cacheinfo", cacheinfo]);
}

fn hash_bytes(root: &Path, bytes: &[u8]) -> Result<String, String> {
    Ok(git_stdin(root, &["hash-object", "-w", "--stdin"], bytes)?
        .trim()
        .to_string())
}

/// Commits `file` as it exists on disk. `None` when it already matches HEAD.
pub fn create(project: &Path, file: &Path, message: &str) -> Result<Option<String>, String> {
    let root = ensure_repo(project)?;
    let rel = relative(&root, file)?;
    guard_ignored(&root, &rel)?;
    let bytes = std::fs::read(file).map_err(|e| format!("cannot read {}: {e}", file.display()))?;
    let blob = hash_bytes(&root, &bytes)?;
    commit_blob(&root, &rel, &blob, message)
}

/// Commits `content` for `file` without touching the working tree.
///
/// This is what makes an incoming external edit recoverable (DESIGN §3.4). By
/// the time the watcher reports Claude's write, the new bytes are already on
/// disk — the state worth preserving exists only in the editor's buffer, so it
/// has to go straight into the object database.
pub fn create_from_content(
    project: &Path,
    file: &Path,
    content: &str,
    message: &str,
) -> Result<Option<String>, String> {
    let root = ensure_repo(project)?;
    let rel = relative(&root, file)?;
    guard_ignored(&root, &rel)?;
    let blob = hash_bytes(&root, content.as_bytes())?;
    commit_blob(&root, &rel, &blob, message)
}

/// Every commit touching `file`, newest first — the user's own commits included,
/// since there is one history now (DESIGN §3.5). The `checkpoint` flag tells
/// them apart so the panel can filter.
pub fn list(project: &Path, file: &Path) -> Result<Vec<Checkpoint>, String> {
    let Some(root) = repo_root(project) else {
        return Ok(Vec::new());
    };
    if !git_ok(&root, &["rev-parse", "--verify", "--quiet", "HEAD"]) {
        return Ok(Vec::new());
    }
    let rel = relative(&root, file)?;

    // Records separated by RS and fields by NUL: a trailer value can in
    // principle contain a newline, which would make line-splitting lossy.
    let format = format!(
        "--format=%x1e%H%x00%h%x00%s%x00%ct%x00%an%x00%(trailers:key={TRAILER},valueonly,separator=%x2C)"
    );
    let out = git(&root, &["log", &format, "--", &rel])?;

    Ok(out
        .split('\u{1e}')
        .filter(|record| !record.trim().is_empty())
        .filter_map(|record| {
            let mut parts = record.split('\0');
            Some(Checkpoint {
                sha: parts.next()?.trim().to_string(),
                short: parts.next()?.to_string(),
                title: parts.next()?.to_string(),
                timestamp: parts.next()?.parse().ok()?,
                author: parts.next()?.to_string(),
                checkpoint: !parts.next()?.trim().is_empty(),
            })
        })
        .collect())
}

/// Content of `file` as of `sha`.
///
/// DESIGN §3.6 — the caller writes it, deliberately. Restoring through the
/// editor's own save path means `lastWrite` recognises the write and the watcher
/// ignores its own echo; it also leaves the user's index alone, which a
/// `checkout -- <path>` would not.
pub fn read_blob(project: &Path, file: &Path, sha: &str) -> Result<String, String> {
    let root = repo_root(project).ok_or("not a git repository")?;
    let rel = relative(&root, file)?;
    let out = checked(&root, None, &["cat-file", "blob", &format!("{sha}:{rel}")])?;
    String::from_utf8(out.stdout).map_err(|_| format!("{rel} at {sha} is not valid UTF-8"))
}

// ---- branches --------------------------------------------------------------

pub fn branches(project: &Path) -> Result<Branches, String> {
    let Some(root) = repo_root(project) else {
        return Ok(Branches::default());
    };

    let refs = |pattern: &str| -> Vec<String> {
        git(
            &root,
            &[
                "for-each-ref",
                "--format=%(refname:short)",
                "--sort=refname",
                pattern,
            ],
        )
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(String::from)
        .collect()
    };

    let local = refs("refs/heads");
    let current = git(&root, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let remotes: Vec<String> = git(&root, &["remote"])
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(String::from)
        .collect();

    let mut remote: Vec<RemoteBranch> = Vec::new();
    for reference in refs("refs/remotes") {
        // `origin/HEAD` is a symbolic alias for another entry in this list, not
        // a branch of its own.
        if reference.ends_with("/HEAD") {
            continue;
        }
        let Some(name) = remotes
            .iter()
            .find_map(|r| reference.strip_prefix(&format!("{r}/")))
        else {
            continue;
        };
        // Anything with a local counterpart is already in `local`, and two
        // remotes can carry the same branch name — first one wins.
        if name.is_empty()
            || local.iter().any(|b| b == name)
            || remote.iter().any(|b| b.name == name)
        {
            continue;
        }
        remote.push(RemoteBranch {
            reference: reference.clone(),
            name: name.to_string(),
        });
    }

    let default_branch = default_branch(&root, &local);
    Ok(Branches {
        current,
        default_branch,
        local,
        remote,
    })
}

/// `origin/HEAD` when the clone recorded one, else the conventional names. Only
/// drives the badge in the dropdown, so a wrong guess is cosmetic.
fn default_branch(root: &Path, local: &[String]) -> Option<String> {
    if let Ok(out) = git(
        root,
        &[
            "symbolic-ref",
            "--quiet",
            "--short",
            "refs/remotes/origin/HEAD",
        ],
    ) {
        if let Some(name) = out.trim().strip_prefix("origin/") {
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    ["main", "master", "trunk"]
        .iter()
        .find(|candidate| local.iter().any(|b| b == *candidate))
        .map(|candidate| (*candidate).to_string())
}

/// Rejected before reaching git so a name starting with `-` can never be read
/// as an option.
fn valid_branch_name(root: &Path, name: &str) -> Result<(), String> {
    if name.is_empty() || name.starts_with('-') {
        return Err(format!("invalid branch name: {name}"));
    }
    if !git_ok(root, &["check-ref-format", "--branch", name]) {
        return Err(format!("invalid branch name: {name}"));
    }
    Ok(())
}

/// git's refusal is surfaced verbatim: the frontend turns it into the
/// stash-and-retry prompt rather than guessing at the cause (DESIGN §3.8).
pub fn switch_branch(project: &Path, name: &str) -> Result<(), String> {
    let root = repo_root(project).ok_or("not a git repository")?;
    valid_branch_name(&root, name)?;
    git(&root, &["switch", name])?;
    Ok(())
}

pub fn create_branch(project: &Path, name: &str) -> Result<(), String> {
    let root = repo_root(project).ok_or("not a git repository")?;
    valid_branch_name(&root, name)?;
    git(&root, &["switch", "--create", name])?;
    Ok(())
}

/// Checks out a remote-tracking branch by creating the local branch that tracks
/// it, which is what picking one from the Remote section means.
pub fn track_branch(project: &Path, reference: &str) -> Result<(), String> {
    let root = repo_root(project).ok_or("not a git repository")?;
    if reference.is_empty() || reference.starts_with('-') {
        return Err(format!("invalid branch: {reference}"));
    }
    git(&root, &["switch", "--track", reference])?;
    Ok(())
}

/// Stashes tracked modifications so a refused switch can proceed. Returns false
/// when there was nothing to stash.
///
/// Untracked files are deliberately left alone: `git switch` never refuses
/// because of them, so `--include-untracked` would remove work for no reason —
/// including a new file Claude had just written.
pub fn stash(project: &Path, label: &str) -> Result<bool, String> {
    let root = repo_root(project).ok_or("not a git repository")?;
    let message = format!("Obelisk: before switching to {label}");
    let out = checked(&root, None, &["stash", "push", "-m", &message])?;
    Ok(!String::from_utf8_lossy(&out.stdout).contains("No local changes"))
}
