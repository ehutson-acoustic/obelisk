//! Checkpoints as commits in a shadow git repo (DESIGN §3).
//!
//! The repo lives at `<project>/.obelisk/git` with the project directory as
//! its work tree, so the user's own repository — its history, index, branches
//! and remotes — is never touched.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Serialize;

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct Checkpoint {
    pub sha: String,
    pub short: String,
    pub title: String,
    /// Commit time, seconds since the epoch.
    pub timestamp: i64,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct CheckpointStatus {
    /// The file differs from the last checkpoint (or has never been committed).
    pub changed: bool,
    /// The file exists in the shadow repo's history.
    pub tracked: bool,
    /// Unified diff against HEAD; empty when the file is new or unchanged.
    pub diff: String,
}

/// Kept out of the shadow repo regardless of the project's own .gitignore.
/// `.obelisk` first and foremost, or the repo would track its own history.
const DEFAULT_EXCLUDES: &str = "\
.obelisk/
node_modules/
target/
.venv/
";

pub fn shadow_dir(project: &Path) -> PathBuf {
    project.join(".obelisk").join("git")
}

pub fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn git(project: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        // Pathspecs resolve relative to the process's working directory, not
        // the work tree. Without pinning this, a `-- notes.md` argument means
        // something different depending on where the app happened to be
        // launched from — and silently matches nothing when the app's cwd is a
        // subdirectory of the project.
        .current_dir(project)
        .env("GIT_DIR", shadow_dir(project))
        .env("GIT_WORK_TREE", project)
        // Keep the user's commit.gpgsign / hooks / templates out of it.
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .args(args)
        .output()
        .map_err(|e| format!("failed to run git: {e}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn git_stdin(project: &Path, args: &[&str], input: &str) -> Result<String, String> {
    let mut child = Command::new("git")
        .current_dir(project)
        .env("GIT_DIR", shadow_dir(project))
        .env("GIT_WORK_TREE", project)
        .env("GIT_CONFIG_NOSYSTEM", "1")
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
        .write_all(input.as_bytes())
        .map_err(|e| e.to_string())?;

    let output = child.wait_with_output().map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Path of `file` relative to the project root, in git's forward-slash form.
fn relative(project: &Path, file: &Path) -> Result<String, String> {
    let rel = file
        .strip_prefix(project)
        .map_err(|_| format!("{} is outside the project", file.display()))?;
    Ok(rel.to_string_lossy().replace('\\', "/"))
}

pub fn ensure_repo(project: &Path) -> Result<(), String> {
    let dir = shadow_dir(project);
    if dir.join("HEAD").exists() {
        return Ok(());
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    git(project, &["init", "--quiet"])?;
    // The shadow repo is the editor's own history, so give it an identity
    // rather than depending on the user having configured a global one.
    git(project, &["config", "user.name", "Obelisk"])?;
    git(project, &["config", "user.email", "obelisk@localhost"])?;
    git(project, &["config", "commit.gpgsign", "false"])?;

    std::fs::write(dir.join("info").join("exclude"), DEFAULT_EXCLUDES)
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn has_head(project: &Path) -> bool {
    git(project, &["rev-parse", "--verify", "HEAD"]).is_ok()
}

pub fn status(project: &Path, file: &Path) -> Result<CheckpointStatus, String> {
    ensure_repo(project)?;
    let rel = relative(project, file)?;

    let tracked = has_head(project)
        && git(project, &["cat-file", "-e", &format!("HEAD:{rel}")]).is_ok();

    // --porcelain covers modified *and* untracked in one call.
    let porcelain = git(project, &["status", "--porcelain", "--", &rel])?;
    let changed = !porcelain.trim().is_empty();

    let diff = if tracked {
        git(project, &["diff", "--no-color", "HEAD", "--", &rel]).unwrap_or_default()
    } else {
        String::new()
    };

    Ok(CheckpointStatus {
        changed,
        tracked,
        diff,
    })
}

/// Commits `file` only (DESIGN §3.2). Returns the short hash, or `None` when
/// there was nothing to commit.
pub fn create(project: &Path, file: &Path, message: &str) -> Result<Option<String>, String> {
    ensure_repo(project)?;
    let rel = relative(project, file)?;

    if !status(project, file)?.changed {
        return Ok(None);
    }

    git(project, &["add", "--", &rel])?;
    let title = if message.trim().is_empty() {
        "Checkpoint"
    } else {
        message.trim()
    };
    git(project, &["commit", "--quiet", "-m", title, "--", &rel])?;

    let short = git(project, &["rev-parse", "--short", "HEAD"])?;
    Ok(Some(short.trim().to_string()))
}

/// Commits `content` for `file` without touching the working tree.
///
/// This is what makes an incoming external edit recoverable (DESIGN §3.4).
/// By the time the watcher reports Claude's write, the new bytes are already
/// on disk — the state worth preserving exists only in the editor's buffer, so
/// it has to be committed straight into the object database.
pub fn create_from_content(
    project: &Path,
    file: &Path,
    content: &str,
    message: &str,
) -> Result<Option<String>, String> {
    ensure_repo(project)?;
    let rel = relative(project, file)?;

    let blob = git_stdin(project, &["hash-object", "-w", "--stdin"], content)?;
    let blob = blob.trim().to_string();

    let head = has_head(project);
    if head {
        // Identical content is already the tip; nothing worth recording.
        if let Ok(existing) = git(project, &["rev-parse", &format!("HEAD:{rel}")]) {
            if existing.trim() == blob {
                return Ok(None);
            }
        }
    }

    if head {
        git(project, &["read-tree", "HEAD"])?;
    } else {
        git(project, &["read-tree", "--empty"])?;
    }
    git(
        project,
        &[
            "update-index",
            "--add",
            "--cacheinfo",
            &format!("100644,{blob},{rel}"),
        ],
    )?;

    let tree = git(project, &["write-tree"])?;
    let tree = tree.trim().to_string();

    let title = if message.trim().is_empty() {
        "Checkpoint"
    } else {
        message.trim()
    };
    let commit = if head {
        git(project, &["commit-tree", &tree, "-p", "HEAD", "-m", title])?
    } else {
        git(project, &["commit-tree", &tree, "-m", title])?
    };
    let commit = commit.trim().to_string();

    git(project, &["update-ref", "HEAD", &commit])?;
    // Leave the index matching the new HEAD so a later `create` sees a clean
    // starting point rather than this synthetic entry.
    git(project, &["read-tree", "HEAD"])?;

    let short = git(project, &["rev-parse", "--short", &commit])?;
    Ok(Some(short.trim().to_string()))
}

pub fn list(project: &Path, file: &Path) -> Result<Vec<Checkpoint>, String> {
    ensure_repo(project)?;
    if !has_head(project) {
        return Ok(Vec::new());
    }
    let rel = relative(project, file)?;

    // NUL-separated so titles containing anything at all stay parseable.
    let out = git(
        project,
        &["log", "--format=%H%x00%h%x00%s%x00%ct", "--", &rel],
    )?;

    Ok(out
        .lines()
        .filter(|line| !line.trim().is_empty())
        .filter_map(|line| {
            let mut parts = line.split('\0');
            Some(Checkpoint {
                sha: parts.next()?.to_string(),
                short: parts.next()?.to_string(),
                title: parts.next()?.to_string(),
                timestamp: parts.next()?.parse().ok()?,
            })
        })
        .collect())
}

/// Restores `file` to its content at `sha`, leaving history linear — the
/// restore is itself a forward state, so nothing is ever stranded.
pub fn restore(project: &Path, file: &Path, sha: &str) -> Result<(), String> {
    ensure_repo(project)?;
    let rel = relative(project, file)?;
    git(project, &["checkout", sha, "--", &rel])?;
    // checkout stages the restored content; unstage so the next checkpoint
    // sees a clean index and commits only what actually changed.
    let _ = git(project, &["reset", "--quiet", "--", &rel]);
    Ok(())
}
