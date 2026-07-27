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

The shadow-repo invocation is two CLI flags, and
`git log --format=%h%x00%s%x00%ct` returns exactly the hash / title / timestamp the versions list needs, already parsed.
No native compilation step, and behavior matches what the user sees running git by hand.

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

### 3.1 Shadow repository

Checkpoints live in a **shadow repo** at `.obelisk/git` — a separate
`--git-dir` sharing the project directory as its `--work-tree`.

The alternative was committing to the project's own repo, as originally specked. Rejected because most target folders
are already repos with real commits, branches, and remotes. Auto-committing on every checkpoint would interleave editor
noise into that history permanently, and the editor would be writing to the same index and `HEAD` the user manipulates
by hand — breaking during rebases, merges, or staged work.

The shadow repo behaves ***identically*** whether the folder is already a repo, and because it shares the working tree
it honors the project's existing
`.gitignore` for free. A default exclude list (`node_modules`, `target`,
`.venv`) covers projects that lack one.

Checkpoints are inspectable with ordinary git:

```bash
git --git-dir=.obelisk/git --work-tree=. log
```

Cost: checkpoints are local-only history and do not push to a remote.

### 3.2 Scope

Commits are **active-file-only**.

Known tradeoff, accepted deliberately: a checkpoint is therefore not a full restore point. Rolling back a document will
not roll back code Claude changed alongside it, so the project can reach a state that never actually existed. The
per-file versions sidebar maps cleanly to this scope.

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

Rows render as:

> `Edit 'Installation' · 4h ago · a3f9c21`

Title, relative timestamp, short hash. Filtered per-file via
`git log -- <path>`.

### 3.6 Restore

Clicking a version:

1. Checkpoints the current content **if it differs** from the last checkpoint.
2. `git checkout <sha> -- <path>`.
3. Reloads the editor.

History stays linear and append-only, so every restore is itself just another forward state and nothing is ever
stranded. No detached `HEAD` to explain or recover from. A full-repo checkout was rejected for exactly that reason — it
would rewrite unrelated files and strand the user in a state the UI would have to talk them out of.

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

* **Project overrides** — `.obelisk/settings.json`, beside the shadow repo.

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

A one-time prompt before adding `.obelisk/git/` to the project's real
`.gitignore`. Never edited silently.

Only the `git/` subdirectory is ignored — `settings.json` stays committable, so project theming can be shared with
collaborators if desired.

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

