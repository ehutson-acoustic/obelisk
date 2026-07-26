# md-editor

A cross-platform Markdown editor with an integrated terminal, built for editing Markdown alongside a live Claude Code
session.

Write in a WYSIWYG view, drop to raw Markdown when you need it, run Claude in the terminal panel beside it, and roll
back any document to any earlier state from a per-file version history that never touches your project's git repo.

Status: **P3 complete** — editor, terminal, and checkpoints all work. Settings and theming (P4) are next; the settings
dialog currently exposes appearance only. See [docs/DESIGN.md](docs/DESIGN.md) for the full design and rationale.

## Features

**Editor** — Milkdown/Crepe WYSIWYG with a selection toolbar, or CodeMirror 6 for the raw source; toggling is a view
swap over the same Markdown string, so nothing is re-serialized. Autosaves 1s after you stop typing (`Cmd/Ctrl+S`
forces it). YAML frontmatter is preserved. Non-markdown files open read-only. When something else writes an open file, a
clean buffer reloads automatically (after checkpointing what it replaced); a dirty one gets a Reload / Keep mine banner.

**Terminal** — tabbed PTYs rooted at the project directory, with a per-project startup command (e.g. `claude`). The tab
bar stays visible when the panel is collapsed; drag it to resize.

**Checkpoints** — per-file version history in a shadow git repo at
`.mdeditor/git`, so your project's own history stays clean. Checkpoints fire manually, before an external change lands
on an open file, and periodically while the buffer is dirty (default 5 min). Titles are generated from the diff
(`Edit 'Installation' in README.md (+12/−3)`) and are editable. Restore commits the current state first, then checks the
old version forward — history stays linear, nothing is stranded.

Inspect them with plain git:

```bash
git --git-dir=.mdeditor/git --work-tree=. log
```

**Session** — projects, open tabs, per-file cursor and scroll, panel sizes, collapse states, and terminal tabs all
restore on launch.

## Requirements

* Node 22+ and pnpm
* Rust 1.94+
* `git` on `PATH` (checkpoints are disabled with a notice if it's missing)
* Linux or macOS. Windows isn't targeted; the PTY layer is where it would need work.

Verified on Ubuntu 24.04 with webkit2gtk 4.1.

## Development

```bash
pnpm install
pnpm tauri dev     # run the app
pnpm test          # vitest unit tests
pnpm tauri build   # bundle
```

Rust integration tests live in `src-tauri/tests` and cover the checkpoint → edit → restore → verify path:

```bash
cd src-tauri && cargo test
```

## Layout

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

## Configuration

* **App settings** — `settings.json` in the OS config dir (`~/.config/md-editor` on Linux). Currently: appearance
  (light/dark/system).
* **Project settings** — `.mdeditor/settings.json`, stored sparsely; absent keys inherit the app default. Currently,
  read: `terminalStartupCommand`,
  `checkpointIntervalMinutes`, `theme`.

md-editor offers once to add `.mdeditor/git/` to your project's `.gitignore`
and never edits it silently. `settings.json` stays committable.

## Stack

Tauri v2 · Rust · React 19 · Vite · TypeScript · Milkdown/Crepe · CodeMirror 6 · xterm.js + tauri-pty · Radix ·
react-resizable-panels
