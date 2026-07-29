//! Integration tests for project-wide search (DESIGN §8.2).
//!
//! The behaviour worth pinning is not "does it find the word" but what it
//! *includes and excludes*: gitignored files, dotfiles, binaries, and untracked
//! files each have a deliberate answer, and each is easy to break silently.

use std::fs;
use std::path::Path;
use std::process::Command;

use obelisk_lib::search::{search, SearchOptions};
use tempfile::TempDir;

fn write(dir: &Path, name: &str, content: &str) {
    let path = dir.join(name);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(path, content).unwrap();
}

fn plain() -> SearchOptions {
    SearchOptions::default()
}

fn hits(dir: &Path, query: &str, options: SearchOptions) -> Vec<String> {
    search(dir, query, &options)
        .unwrap()
        .files
        .into_iter()
        .map(|f| f.relative)
        .collect()
}

#[test]
fn finds_matches_with_line_numbers_and_offsets() {
    let dir = TempDir::new().unwrap();
    write(
        dir.path(),
        "notes.md",
        "first line\nsecond has needle here\n",
    );

    let outcome = search(dir.path(), "needle", &plain()).unwrap();
    assert_eq!(outcome.total, 1);
    assert_eq!(outcome.files.len(), 1);

    let hit = &outcome.files[0].matches[0];
    assert_eq!(hit.line, 2);
    assert_eq!(hit.text, "second has needle here");
    assert_eq!(&hit.text[hit.start..hit.end], "needle");
    assert!(outcome.files[0].path.ends_with("notes.md"));
    assert_eq!(outcome.files[0].relative, "notes.md");
}

#[test]
fn is_case_insensitive_until_told_otherwise() {
    let dir = TempDir::new().unwrap();
    write(dir.path(), "a.md", "Needle\n");

    assert_eq!(hits(dir.path(), "needle", plain()).len(), 1);
    assert!(hits(
        dir.path(),
        "needle",
        SearchOptions {
            case_sensitive: true,
            ..plain()
        }
    )
    .is_empty());
}

#[test]
fn treats_the_query_literally_unless_regexp_is_set() {
    let dir = TempDir::new().unwrap();
    write(dir.path(), "a.md", "cost is 1+2 dollars\n");

    // `1+2` as a regex means "one or more 1s then a 2", which this line does not
    // contain — so a literal search must find it and a regex search must not.
    assert_eq!(hits(dir.path(), "1+2", plain()).len(), 1);
    assert!(hits(
        dir.path(),
        "1+2",
        SearchOptions {
            regexp: true,
            ..plain()
        }
    )
    .is_empty());
}

#[test]
fn supports_regexp_and_whole_word() {
    let dir = TempDir::new().unwrap();
    write(dir.path(), "a.md", "release v1.2.3 shipped\nsubrelease\n");

    let outcome = search(
        dir.path(),
        r"v\d+\.\d+\.\d+",
        &SearchOptions {
            regexp: true,
            ..plain()
        },
    )
    .unwrap();
    assert_eq!(outcome.total, 1);
    assert_eq!(&outcome.files[0].matches[0].text, "release v1.2.3 shipped");

    let whole = search(
        dir.path(),
        "release",
        &SearchOptions {
            whole_word: true,
            ..plain()
        },
    )
    .unwrap();
    assert_eq!(whole.total, 1, "`subrelease` must not count as the word");
}

#[test]
fn reports_an_invalid_pattern_rather_than_returning_nothing() {
    let dir = TempDir::new().unwrap();
    write(dir.path(), "a.md", "text\n");

    let err = search(
        dir.path(),
        "unclosed(",
        &SearchOptions {
            regexp: true,
            ..plain()
        },
    )
    .unwrap_err();
    assert!(err.contains("invalid search pattern"), "got: {err}");
}

#[test]
fn skips_gitignored_files_but_finds_untracked_ones() {
    let dir = TempDir::new().unwrap();
    Command::new("git")
        .current_dir(dir.path())
        .args(["init", "--quiet"])
        .output()
        .unwrap();
    write(dir.path(), ".gitignore", "build/\n");
    write(dir.path(), "build/generated.md", "needle\n");
    // Never committed, never added — the case `git grep` would miss entirely,
    // which is why this is not implemented with `git grep`.
    write(dir.path(), "fresh.md", "needle\n");

    assert_eq!(hits(dir.path(), "needle", plain()), vec!["fresh.md"]);
}

#[test]
fn searches_dotfiles_and_dot_directories() {
    let dir = TempDir::new().unwrap();
    write(dir.path(), ".claude/CLAUDE.md", "needle\n");
    write(dir.path(), ".env.example", "needle\n");

    let found = hits(dir.path(), "needle", plain());
    assert!(
        found.contains(&".claude/CLAUDE.md".to_string()),
        "the file browser shows dotfiles, so search must reach them: {found:?}"
    );
    assert!(found.contains(&".env.example".to_string()), "{found:?}");
}

#[test]
fn never_walks_into_the_git_directory() {
    let dir = TempDir::new().unwrap();
    Command::new("git")
        .current_dir(dir.path())
        .args(["init", "--quiet"])
        .output()
        .unwrap();
    write(dir.path(), "notes.md", "commit\n");
    Command::new("git")
        .current_dir(dir.path())
        .args(["add", "-A"])
        .output()
        .unwrap();

    // ".git" holds config and refs containing all sorts of words; results from
    // inside it are never useful and would swamp the panel.
    for relative in hits(dir.path(), "commit", plain()) {
        assert!(!relative.starts_with(".git/"), "leaked: {relative}");
    }
}

#[test]
fn skips_binary_files() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("blob.bin"), b"needle\x00\x01\x02needle").unwrap();
    write(dir.path(), "real.md", "needle\n");

    assert_eq!(hits(dir.path(), "needle", plain()), vec!["real.md"]);
}

#[test]
fn finds_nested_paths_and_reports_them_relative() {
    let dir = TempDir::new().unwrap();
    write(dir.path(), "docs/deep/inside.md", "needle\n");

    assert_eq!(
        hits(dir.path(), "needle", plain()),
        vec!["docs/deep/inside.md"]
    );
}

#[test]
fn an_empty_query_returns_nothing_rather_than_everything() {
    let dir = TempDir::new().unwrap();
    write(dir.path(), "a.md", "content\n");

    let outcome = search(dir.path(), "", &plain()).unwrap();
    assert!(outcome.files.is_empty());
    assert_eq!(outcome.total, 0);
    assert!(!outcome.truncated);
}

#[test]
fn caps_matches_per_file_and_says_so() {
    let dir = TempDir::new().unwrap();
    let many = "needle\n".repeat(120);
    write(dir.path(), "many.md", &many);

    let outcome = search(dir.path(), "needle", &plain()).unwrap();
    assert_eq!(outcome.files[0].matches.len(), 50, "MAX_PER_FILE");
    assert!(
        outcome.truncated,
        "a shortened list must announce itself, not look complete"
    );
    assert!(outcome.files[0].truncated);
}

#[test]
fn results_are_ordered_deterministically() {
    let dir = TempDir::new().unwrap();
    for name in ["c.md", "a.md", "b.md"] {
        write(dir.path(), name, "needle\n");
    }

    assert_eq!(
        hits(dir.path(), "needle", plain()),
        vec!["a.md", "b.md", "c.md"]
    );
    assert_eq!(
        hits(dir.path(), "needle", plain()),
        hits(dir.path(), "needle", plain()),
        "the same search twice must read the same way"
    );
}
