# Obelisk — Design

A cross-platform Markdown editor with an integrated terminal, built for editing Markdown alongside a live Claude Code
session.

This document records the decisions made during design and the reasoning behind them. It is the reference for why things
are the way they are; when a question resurfaces, the answer should be here.

Status: agreed 2026-07-25. Implementation in progress.

***

## 1. Stack

| Layer         | Choice                                  |
|---------------|-----------------------------------------|
| Shell         | Tauri v2                                |
| Backend       | Rust 1.94                               |
| Frontend      | React + Vite + TypeScript               |
| UI primitives | Radix / shadcn (dialogs, context menus) |
| WYSIWYG       | Milkdown / Crepe (ProseMirror + remark) |
| Source view   | CodeMirror 6, markdown mode             |
| Terminal      | `@xterm/xterm` + `tauri-plugin-pty`     |
| Git           | shell out to the system `git` binary    |
| Splitters     | `react-resizable-panels`                |

### 1.1 Why Milkdown instead of Editor.js

The original spec called for Editor.js. It was replaced.

Editor.js's document model is block JSON, not Markdown. There is no first-party Markdown support; import/export relies
on community plugins. For an app whose files on disk are `.md` and whose core feature is git-diffing those files against
Claude's edits, every WYSIWYG↔source toggle would be a lossy re-serialization — reordered attributes, dropped HTML
blocks, reflowed lists. That noise would land in every checkpoint diff.

Milkdown is ProseMirror + remark, where the Markdown *is* the document model. The toggle between WYSIWYG and source
becomes a view swap over the same string rather than a conversion. Its Crepe preset also already provides the exact
interaction specced — a floating toolbar on text selection, no top toolbar — plus GFM task lists and per-component
CSS-variable theming, which the theming requirement needs regardless.

### 1.2 Why shell out to git

`git log --format=%h%x00%s%x00%ct` returns exactly the hash / title / timestamp the versions list needs, already parsed,
and the plumbing commands §3.1 leans on (`hash-object`, `read-tree`, `commit-tree`, `update-ref`) are far easier to reach
correctly through the CLI than through a library. No native compilation step, and behavior matches what the user sees
running git by hand — which matters more now that the editor and the user commit to the same branch.

Cost: requires `git` on `PATH`. Detected at startup with a clear message if absent. Acceptable — anyone running Claude
Code already has it.

Rejected: `git2`/libgit2 (more code per commit, native build burden on every platform), `gitoxide` (write-side APIs
still shifting).

### 1.3 Filesystem scope

Tauri v2 gates `plugin-fs` behind an allowlist. The capability grants `/**`.

Scoping to `$HOME/**` was tried first and rejected: projects legitimately live outside the home directory, and the
failure mode is bad — `readTextFile` throws, the editor shows an empty document, and nothing obvious says why. Since the
webview only ever loads local application content and never remote pages, a broad filesystem scope grants no reach that
the app doesn't already have.

The plugin also needs `requireLiteralLeadingDot: false` in `tauri.conf.json`. It defaults to `true` on Unix, which means
no glob pattern matches a path containing a dot-directory — so a project under `~/.config`, `~/.local`, or any dotfile
repo silently fails to open *and* fails to watch, with the reads and the file watcher failing independently for the same
reason. Nothing in the app has a reason to treat dot-directories as hidden.

***

## 2. Editor behavior

### 2.1 Formatting toolbar

Crepe's selection toolbar, configured to exactly: **bold, italic, header, link, code block, bullet list, numbered list,
checkbox list, block quote**. No top toolbar. The WYSIWYG/source toggle sits in the top right of the editor panel.

### 2.2 Save policy

Debounced autosave at ~1s idle. `Ctrl`/`Cmd`+`S` force-saves.

Two agents write these files: the user in the editor, and Claude in the terminal. The longer unsaved changes sit in a
buffer, the wider the window where Claude reads a stale file off disk and overwrites work. Autosave narrows that window
to about a second. Git checkpoints already provide undo, so there is no safety argument for holding changes in memory.

Consequence: there is no "abandon my edits without saving" escape hatch. Reverting is done via checkpoint.

### 2.3 External file changes

The defining interaction of the app: Claude writes a file that is open in the editor. Detected via
`@tauri-apps/plugin-fs`'s `watch`.

* **Buffer clean** (the normal case under autosave): reload silently, preserving cursor and scroll position. Watching
  Claude edit feels live.

* **Buffer dirty** (mid-keystroke): non-blocking banner offering *Reload* / *Keep Mine* / *Show Diff*. Never destroy
  in-flight typing.

Writes originating from our own autosave are echo-suppressed, or the watcher would trigger a reload loop against itself.

### 2.4 Markdown flavor

GFM: tables, strikethrough, task lists.

### 2.5 YAML frontmatter

Parsed via `remark-frontmatter` into a distinct node, rendered as a compact collapsed bar at the top of the document,
expandable to view.

Without this, remark parses a leading `---` block as a thematic break followed by a heading. Because autosave writes the
serialized document straight back to disk, that mangling would be persisted — silent corruption of any file with
frontmatter, which is the worst failure mode available in this app. Round-trips byte-identically.

***

## 3. Checkpoints

### 3.1 The project's own repository

Checkpoints are ordinary commits in the **project's own git repository**, on whatever branch is checked out.

This reverses an earlier decision. Checkpoints originally lived in a shadow repo at `.obelisk/git` — a separate
`--git-dir` sharing the project directory as its `--work-tree` — specifically to keep editor noise out of real history
and to avoid writing to the `HEAD` and index the user manipulates by hand. Living with it showed the cost was higher
than the benefit: a second, invisible history that never pushes, cannot be reviewed, is not reachable from any normal git
command the user already knows, and has no relationship to the branch they are actually working on. Real commits on a
real branch are worth the noise.

What made the reversal safe is not that the original objection was wrong — it was right — but that each half of it is now
handled explicitly:

* **The index.** Commits are assembled in a **scratch index** (`GIT_INDEX_FILE` pointing at a throwaway file in the git
  dir), never with `git add`. `read-tree HEAD` → `hash-object` → `update-index` → `write-tree` → `commit-tree` →
  `update-ref`, with the old ref value passed so a concurrent update loses rather than being clobbered. Staged work on
  every other path survives a checkpoint untouched.

* **In-flight operations.** Checkpointing is refused outright while HEAD is detached or a rebase, merge, cherry-pick,
  revert, or bisect is in progress — detected from the marker files git itself leaves in the git dir. The button
  disables and says which.

* **Ignored files.** A gitignored file is never committed. Harmless in a shadow repo; in real history it would push a
  file the user deliberately untracked.

Commits use the **user's own git identity**, because they are the user's commits. They are never signed, even with
`commit.gpgsign` set: a passphrase prompt would block an autosave. They are made with `commit-tree`, which does not run
hooks, so a checkpoint deliberately bypasses `pre-commit` and `commit-msg`.

Checkpoints carry an `Obelisk-Checkpoint: 1` trailer so they can be told apart from hand-made commits in the one shared
history (§3.5).

A folder that is not a repository gets one from `git init` on its first checkpoint, as the shadow repo did.

### 3.2 Scope

Commits are **active-file-only**.

Known tradeoff, accepted deliberately: a checkpoint is therefore not a full restore point. Rolling back a document will
not roll back code Claude changed alongside it, so the project can reach a state that never actually existed. The
per-file versions sidebar maps cleanly to this scope.

One consequence of §3.1 that has no clean answer: after committing, the real index entry **for that path** is pointed at
the new blob. Leaving it stale was the original intent and does not work — the index would still hold the pre-checkpoint
blob, so `git status` reports a staged *reversal* of the file, the user's next `git commit` would undo the checkpoint, and
a two-way `git switch` reads the index and gets the wrong answer about what the file is. The cost is that a version of
that same file the user had staged is superseded. Refusing to checkpoint instead was rejected outright: the
before-an-external-change trigger (§3.4) is what rescues unsaved writing and must never decline. `CheckpointStatus.staged`
exists so the dialog warns first.

### 3.3 Title generation

Auto-generated by a markdown-aware diff heuristic: find the nearest `#` heading above the changed hunk, pair it with
line stats.

> `Edit 'Installation' in README.md (+12/−3)`

Falls back to filename + stats when no heading applies. The checkpoint dialog opens with this pre-filled and fully
editable. Instant, offline, no tokens.

### 3.4 Triggers

1. **Manual** — the Checkpoint button in the header bar.
2. **Before an external change lands** — snapshot the previous content immediately before Claude's write is applied to
   an open file. This makes every Claude edit recoverable by construction, and fires only when something real happened.
3. **Periodically while dirty** — default 5 minutes, exposed in settings.

### 3.5 Versions list

`git log -- <path>` on the project's repo, so the list is the file's **whole history** — the user's own commits included,
not only the editor's. That is the payoff of §3.1: a file can be restored to how it looked in any commit, not just one
Obelisk happened to make. Rows render as:

> `⌷ Edit 'Installation' · 4h ago · a3f9c21`
>
> `Fix the install steps · 3d ago · Real User · 91be40c`

Title, relative timestamp, short hash; the author for commits the editor did not make, and a mark for the ones it did.
A **Checkpoints only** toggle in the panel header filters to trailer-tagged commits, because a long-lived file in a real
repo has far more commits than a shadow repo ever accumulated. The toggle persists in `session.json`.

### 3.6 Restore

Clicking a version:

1. Checkpoints the current content **if it differs** from HEAD.
2. Reads the file's blob at that commit (`cat-file blob <sha>:<path>`).
3. Writes it through the editor's **own save path**, then reloads.

Step 3 is deliberately not `git checkout <sha> -- <path>`. Writing it ourselves means the write passes through the
`lastWrite` ref, so the file watcher recognises its own echo instead of treating the restore as an external change; and it
leaves the index alone, which `checkout` would not.

History stays linear and append-only, so every restore is itself just another forward state and nothing is ever
stranded. No detached `HEAD` to explain or recover from. A full-repo checkout was rejected for exactly that reason — it
would rewrite unrelated files and strand the user in a state the UI would have to talk them out of.

### 3.7 Branch picker

A dropdown beside the Checkpoint button showing the current branch, modeled on GitHub's: a filter field, local branches
with the current one checked and the default badged, a **Remote** section of remote-tracking branches that have no local
counterpart, and a `Create branch "<typed>" from <current>` row that appears when the filter matches nothing. New
branches are created from the current HEAD and switched to immediately. No tags tab, no view-all.

Picking a remote entry runs `switch --track origin/<name>`, creating the local branch. The list reads local refs only —
there is deliberately no automatic `fetch`, so opening the dropdown never blocks on the network.

A detached HEAD shows the short sha instead of a name, which is also when checkpointing is disabled (§3.1).

### 3.8 Switching branches

`git switch` rewrites the working tree, so the editor has to assume open files changed underneath it.

1. Flush the pending autosave and **checkpoint the active buffer if it is dirty**, so prose is recoverable no matter what
   happens next. Only the active file can be dirty — it is the only one with an in-memory buffer.
2. `git switch`. If git refuses, its stderr is shown **verbatim** in the dropdown with two buttons: *Stash changes and
   switch* and *Cancel*. Nothing is stashed without a click, and the stash excludes untracked files — `switch` never
   refuses because of them, so sweeping them away would discard work (possibly a file Claude just wrote) for nothing.
3. On success, tabs for files that do not exist on the new branch are closed; the rest reload through the normal path.
   Only files under the active project's directory are touched.

Auto-stashing on every switch was rejected: it makes switching always succeed, at the cost of silently removing
in-flight work the user did not ask to put away.

***

## 4. Terminal

A new tab runs the **per-project startup command**, empty by default, which means a plain `$SHELL` at the project root.

Claude Code resolves its project context from its working directory, so launching at the project root rather than a
subfolder gives it the whole project to work with. cwd deliberately does not follow the focused file tab — that would
silently change what Claude can see as the user switches tabs.

Two pieces of timing matter, both found by testing rather than by reading:

* The command is **resolved when the tab is created** and stored on the tab, not read at mount. The terminal spawns as
  soon as the shell path is known which always beats the async project-settings read, so a mount-time lookup captures
  `undefined` and the command silently never runs.

* It is **sent after the shell's first output**, not immediately after spawn. An interactive shell discards pending
  input as type-ahead while it is still reading its startup files, so an immediate write is swallowed.

The command is written into the interactive shell rather than exec'd, so the tab survives the command exiting.

***

## 5. Settings

### 5.1 Locations

* **App defaults** — OS-appropriate config directory, resolved by Tauri (`~/.config/Obelisk` on Linux,
  `~/Library/Application Support/…` on macOS).

* **Project overrides** — `.obelisk/settings.json`. This is now the only thing `.obelisk/` holds; the `git/`
  subdirectory went away with §3.1.

### 5.2 Inheritance

Project settings are stored **sparsely** — only keys that differ from app defaults. The file stays small and readable,
and future changes to defaults flow through to existing projects automatically.

| Scope               | Settings                                                                            |
|---------------------|-------------------------------------------------------------------------------------|
| Project-overridable | markdown theme, per-component styles, checkpoint interval, terminal startup command |
| App-only            | light / dark / system mode, layout sizes                                            |

Appearance mode is deliberately app-only. Making it per-project means switching projects flips the whole app between
light and dark, which reads as a bug.

The settings UI marks each field as inherited or overridden, with a reset-to-default control. Granularity differs by
kind: scalar settings are marked per field, while Markdown styling is marked per **component** rather than per CSS
property — tagging all five properties of all nine components individually would be forty-five badges for very little
gain. Resetting a component drops the whole override for it and returns to the app default.

### 5.3 Theming

A theme is a named set of CSS variable values, since that is how Crepe styles everything.

Per-component editing covers a **fixed component list** — body, h1–h3, links, inline code, code blocks, blockquote,
lists — each exposing font family, size, weight, color, and line-height. Editing a shipped preset forks it into
"Custom".

Bounded on purpose. A full CSS property inspector is a project of its own and the easiest way to produce an unreadable
editor.

### 5.4 .gitignore

Nothing. Obelisk does not touch the project's `.gitignore`.

There used to be a one-time prompt offering to add `.obelisk/git/`, which existed only because the shadow repo wrote
history into the project directory. With §3.1 there is no such directory, and `.obelisk/settings.json` was always meant
to be committable so project settings can be shared. The prompt, and the `gitignorePrompted` session field that
remembered the answer, are gone.

Obelisk does *read* the project's ignore rules: a gitignored file cannot be checkpointed (§3.1).

***

## 6. Layout

```
┌──────────────────────────────────────────────────────────┐
│ file tabs                         [Checkpoint] [▶ right] │ header
├──────────┬────────────────────────────────┬──────────────┤
│ projects │ editor           [WYSIWYG|src] │ file browser │
│  cards   │                                ├──────────────┤
│          │                                │   versions   │
│          ├────────────────────────────────┤              │
│          │ term 1 │ term 2 │ +  [collapse]│              │
│[collapse]│                                │              │
│ [gear]   ├────────────────────────────────┤              │
│          │ /path/to/file.md   [copy] [new]│              │
└──────────┴────────────────────────────────┴──────────────┘
   sidebar          editor column              sidebar
 (full height)  editor / terminal / footer  (full height)
```

* **Header** — spans the full width. Its file tabs are indented by the live width of the left sidebar so they line up
  with the editor.

* **Sidebars** — both are full-height columns running from under the header to the bottom of the window. The editor,
  terminal and footer stack between them.

* **Left sidebar** — project cards. Collapses to a 56px rail; toggle sits just above the settings gear, which is pinned
  to the bottom. Both carry labels when expanded and shrink to icons when collapsed.

* **Right sidebar** — file browser on top, versions below, draggable divider between them. Collapses completely; toggle
  lives in the header bar.

  The tree lists everything in the directory, with no exclusions — dot-entries included, since `.claude/`, `.github/`,
  `.gitignore` and `.obelisk/settings.json` are all things you edit from here, consistent with §1.3. Hiding `.git/` and
  the shadow repo was tried and rejected: any exclusion list makes the tree lie about what is on disk, which matters
  most in exactly the case where you went looking for a file the agent wrote.

* **Terminal** — tabbed, `+` to the right of the tabs. The tab bar lives inside the panel and the panel's collapsed size
  equals the bar height, so the bar — and its expand toggle — survives collapsing while every button stays clickable.
  Resizing is a thin grip along the top edge only; making the whole bar the drag handle was tried first and made the
  tabs and buttons awkward to hit.

* **Footer** — full file path, ellipsed on the left when too long, plus quick buttons to copy file contents and create a
  new file in the current folder. Sits inside the editor column, between the sidebars.

### 6.1 Project cards

The card's configured color fills the **entire card background**. The selected card is distinguished by its outline.

Title text color is derived from the background's luminance (WCAG contrast check) rather than hardcoded, so titles stay
readable against any chosen color.

Right-click menu: Edit, Settings, Remove. Removing a project removes it from the list only — it never touches files on
disk.

***

## 7. Session persistence

Stored as `session.json` in the app config directory. Restores:

* projects list and active project

* open file tabs and which was focused

* per-file cursor and scroll position

* sidebar collapse states and all panel sizes

* terminal tabs by count and cwd

A stored cursor is tagged with the view that produced it. ProseMirror positions count node boundaries and CodeMirror
offsets don't, so an offset from one view lands somewhere arbitrary in the other; the cursor is restored only when the
modes match, rather than jumping the caret to a wrong position on toggle.

Terminal tabs respawn as fresh shells. PTY processes die with the app, so scrollback cannot be restored.

***

## 8. Platforms

Linux and macOS.

A Cmd/Ctrl modifier abstraction and the macOS menu bar are built in from the start rather than retrofitted. Windows is
not targeted but nothing should preclude it — the PTY layer is where it would most likely need work, since ConPTY
differs meaningfully from Unix ptys.

Verified dev environment: Ubuntu 24.04, webkit2gtk 4.1, Node 22.17, pnpm 10.29, Rust 1.94, git 2.43.

***

## 9. Testing

* **Rust integration tests** over throwaway repos, exercising checkpoint → edit → restore → verify-content.

* **Unit tests** for settings merge, the diff-heuristic title generator, and relative-time formatting.

* **UI** verified by hand.

The checkpoint/restore path can destroy the user's writing, and its failure mode is silent — a wrong restore looks like
a successful one. That is the piece worth covering regardless of how light testing stays elsewhere. Tauri E2E was
rejected as slow and flaky enough to end up ignored.

***

## 10. Build order

| Phase  | Contents                                                                                                                              |
|--------|---------------------------------------------------------------------------------------------------------------------------------------|
| **P1** | Tauri shell, three-panel layout with splitters and collapse, project sidebar, file browser, open/edit/autosave, WYSIWYG↔source toggle |
| **P2** | Terminal panel                                                                                                                        |
| **P3** | Checkpoints and versions sidebar                                                                                                      |
| **P4** | Settings and theming                                                                                                                  |

Each phase ends somewhere usable, and dependencies flow forward without rework.

***

## 11. Open questions

Recorded assumptions, not yet exercised in real use. Revisit when they bite.

1. **Non-markdown files** — the file browser shows all files; only Markdown opens in the WYSIWYG. Clicking a
   non-markdown file opens it read-only in CodeMirror. Alternatives: filter the browser to `.md` only, or make
   everything editable.
2. **File browser root** — rooted at the project directory, with no navigation above it.
3. **Checkpoint interval** — 5 minutes is a guess. Adjust once there is a feel for how noisy the versions list gets.

