//! Project-wide search, over ripgrep's own crates (DESIGN §8.2).
//!
//! `ignore` gives gitignore semantics and `grep` gives the matcher and the
//! line-oriented searcher, so the results match what `rg` would print without
//! requiring `rg` to be installed. Notably this searches files git has never
//! seen, which `git grep` cannot — a note written a minute ago is exactly the
//! thing worth finding.

use std::path::Path;

use grep::matcher::Matcher;
use grep::regex::{RegexMatcher, RegexMatcherBuilder};
use grep::searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkMatch};
use ignore::WalkBuilder;
use serde::{Deserialize, Serialize};

/// Bounds on the result set. Whichever one bites is reported back through
/// `truncated` — a silently shortened list reads as "that's all there is".
const MAX_FILES: usize = 500;
const MAX_PER_FILE: usize = 50;
const MAX_TOTAL: usize = 2000;

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct SearchMatch {
    /// 1-based, as editors count lines.
    pub line: u64,
    /// The matching line, without its terminator.
    pub text: String,
    /// Byte offsets of the match inside `text`, for highlighting.
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct FileMatches {
    /// Absolute path, for opening the file.
    pub path: String,
    /// Project-relative path, for display.
    pub relative: String,
    pub matches: Vec<SearchMatch>,
    /// More matches exist in this file than `MAX_PER_FILE` allowed.
    pub truncated: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
pub struct SearchOutcome {
    pub files: Vec<FileMatches>,
    /// Total matches returned, which is not the total that exist if truncated.
    pub total: usize,
    pub truncated: bool,
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct SearchOptions {
    pub case_sensitive: bool,
    pub whole_word: bool,
    pub regexp: bool,
}

/// Collects the matches for one file.
struct Collector<'m> {
    matcher: &'m RegexMatcher,
    matches: Vec<SearchMatch>,
    limit: usize,
    truncated: bool,
}

impl Sink for Collector<'_> {
    type Error = std::io::Error;

    fn matched(&mut self, _searcher: &Searcher, m: &SinkMatch<'_>) -> Result<bool, Self::Error> {
        let bytes = m.bytes();
        // Offsets are wanted relative to the line, and the matcher is the only
        // thing that knows where inside it the hit actually landed.
        let (start, end) = self
            .matcher
            .find(bytes)
            .ok()
            .flatten()
            .map(|found| (found.start(), found.end()))
            .unwrap_or((0, 0));

        let text = String::from_utf8_lossy(bytes)
            .trim_end_matches(['\n', '\r'])
            .to_string();

        self.matches.push(SearchMatch {
            line: m.line_number().unwrap_or(0),
            text,
            start,
            end,
        });

        if self.matches.len() >= self.limit {
            self.truncated = true;
            // Returning false stops the search for this file only.
            return Ok(false);
        }
        Ok(true)
    }
}

fn build_matcher(query: &str, options: &SearchOptions) -> Result<RegexMatcher, String> {
    let mut builder = RegexMatcherBuilder::new();
    builder
        // Smart-case is deliberately not used: the checkbox in the find bar means
        // what it says, and an implicit rule would contradict it.
        .case_insensitive(!options.case_sensitive)
        .word(options.whole_word)
        // A literal query must not have its punctuation read as syntax.
        .fixed_strings(!options.regexp)
        // Keeps a stray `.*` from matching across the whole file, which would
        // make one "line" the entire document.
        .multi_line(false);
    builder
        .build(query)
        .map_err(|e| format!("invalid search pattern: {e}"))
}

pub fn search(
    project: &Path,
    query: &str,
    options: &SearchOptions,
) -> Result<SearchOutcome, String> {
    if query.is_empty() {
        return Ok(SearchOutcome {
            files: Vec::new(),
            total: 0,
            truncated: false,
        });
    }
    let matcher = build_matcher(query, options)?;

    let mut searcher = SearcherBuilder::new()
        .line_number(true)
        // Anything with a NUL in the first block is treated as binary and skipped,
        // rather than spilling one enormous unreadable "line" into the results.
        .binary_detection(BinaryDetection::quit(0))
        .build();

    let walker = WalkBuilder::new(project)
        // The file browser shows dotfiles, so search must reach them too — a
        // hidden `.claude/` or `.github/` is ordinary project content.
        .hidden(false)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .parents(true)
        .filter_entry(|entry| entry.file_name() != ".git")
        // Deterministic order, so the same search twice reads the same way.
        .sort_by_file_path(|a, b| a.cmp(b))
        .build();

    let mut files: Vec<FileMatches> = Vec::new();
    let mut total = 0usize;
    let mut truncated = false;

    for entry in walker {
        if files.len() >= MAX_FILES || total >= MAX_TOTAL {
            truncated = true;
            break;
        }
        let Ok(entry) = entry else { continue };
        if !entry.file_type().is_some_and(|t| t.is_file()) {
            continue;
        }

        let mut collector = Collector {
            matcher: &matcher,
            matches: Vec::new(),
            limit: MAX_PER_FILE.min(MAX_TOTAL.saturating_sub(total)),
            truncated: false,
        };
        // An unreadable file is skipped rather than failing the whole search:
        // one permission error should not empty the results panel.
        if searcher
            .search_path(&matcher, entry.path(), &mut collector)
            .is_err()
        {
            continue;
        }
        if collector.matches.is_empty() {
            continue;
        }

        total += collector.matches.len();
        truncated |= collector.truncated;
        files.push(FileMatches {
            path: entry.path().to_string_lossy().into_owned(),
            relative: entry
                .path()
                .strip_prefix(project)
                .unwrap_or(entry.path())
                .to_string_lossy()
                .replace('\\', "/"),
            matches: collector.matches,
            truncated: collector.truncated,
        });
    }

    Ok(SearchOutcome {
        files,
        total,
        truncated,
    })
}
