# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Obelisk is a Tauri v2 desktop app: a Markdown editor (WYSIWYG + raw source) with an integrated terminal, built for
editing Markdown while a Claude Code session runs in the panel beside it. Per-file version history ("checkpoints") is
ordinary commits in the project's own git repo, on the checked-out branch.

`docs/DESIGN.md` is the authority on *why* things are the way they are, section-numbered and referenced from the code
(`DESIGN §3.4`). Read the relevant section before changing behavior in that area, and update it when a decision changes.

## Commands

```bash
pnpm install
pnpm tauri dev                          # run the app (starts vite on :1420 itself)
pnpm test                               # vitest, all unit tests
pnpm vitest run src/lib/contrast.test.ts # single file
pnpm vitest run -t "sparseOverrides"    # single suite/test by name
pnpm build                              # tsc typecheck + vite build
pnpm tauri build                        # bundle (deb/appimage targets configured)

cd src-tauri && cargo test              # Rust integration tests
cd src-tauri && cargo test round_trips_content_through_restore
```

There is no ESLint/Prettier config. `pnpm build` (i.e. `tsc`) is the lint: `strict`, `noUnusedLocals`,
`noUnusedParameters`. The `eslint-disable-next-line react-hooks/exhaustive-deps` comments are deliberate markers on
mount-once effects, not leftovers.

There is no vitest config file — tests needing a DOM opt in per file with a leading `// @vitest-environment jsdom`
comment (see `src/lib/frontmatter.test.ts`).

Requires Node 22+, pnpm, Rust 1.94+, and `git` on `PATH`. Linux/macOS only; Windows is not targeted.

## Architecture

**Rust is thin-ish.** `src-tauri/src/lib.rs` exposes fourteen commands: `default_shell`, `system_fonts`,
`git_available`, five `checkpoint_*`, `repo_state`, four `branch_*`, and `git_stash` — all but the first two thin wrappers
around `checkpoints.rs`. Everything else — file reads/writes, directory listing, the file
watcher, config persistence — happens in the frontend through `@tauri-apps/plugin-fs`. Adding a Rust command means
registering it in `invoke_handler!`; adding a new fs/plugin API usually means adding a permission to
`src-tauri/capabilities/default.json`.

**`src/App.tsx` is the orchestrator** (~1000 lines, sectioned by `// ---- name ----` comments). It owns all cross-cutting
state and every effect: session load/save, panel layout, autosave, the external-change watcher, checkpoint triggers,
theme application. Components in `src/components/` are largely presentational and receive callbacks; `src/lib/` holds
pure logic (unit-tested) plus thin `invoke` wrappers. Adding a feature usually means a lib function + a component + wiring
in `App.tsx`.

**One `Session` object is the app's state** (`src/types.ts`), persisted debounced to `session.json` in the OS app config
dir. Loading shallow-merges over `DEFAULT_SESSION` so new keys pick up defaults — keep new fields optional-safe rather
than writing a migration.

### Three config layers

| File | Written by | Holds |
|---|---|---|
| `session.json` (app config dir) | `lib/session.ts` | window/panel state, open tabs, projects, terminals |
| `settings.json` (app config dir) | `lib/appSettings.ts` | appearance (app-only) + default `EditorSettings` |
| `<project>/.obelisk/settings.json` | `lib/projectSettings.ts` | **sparse** project overrides |

`lib/editorSettings.ts` is the merge engine: `BASE ⊕ preset ⊕ per-component edits` (`resolveComponents`), app defaults ⊕
project overrides (`mergeSettings`), and `sparseOverrides` on the way back out so only real differences are stored.
Never write a full settings object into a project file.

### Editor: two imperative views, remounted not updated

`components/Editor.tsx` mounts either Crepe/Milkdown or CodeMirror 6 imperatively. Both own their own document state, so
`value` and `cursor` are **initial values only**. The parent forces a fresh mount via `key = \`${path}:${revision}\``;
`revision` is bumped whenever the file is reloaded from disk. Do not try to push content into a mounted view — bump
`revision`.

Cursor positions are tagged with the `EditorMode` that produced them (`OpenFile.cursorMode`), because ProseMirror
positions and CodeMirror offsets are not interchangeable; restore only when the modes match.

### Save / watch loop — the invariant to preserve

Autosave fires 1s after typing stops (`Cmd/Ctrl+S` forces it) because Claude may read the file off disk at any moment.
The `lastWrite` ref holds the content of our own most recent write so the `plugin-fs` watcher can ignore its own echo;
break that and the app reload-loops against itself. On an external change: clean buffer → checkpoint the in-memory
content first, then reload silently; dirty buffer → set `conflict` and show the Reload/Keep-mine banner. There is
deliberately no "discard my changes" path — reverting goes through checkpoints.

### Checkpoints (`src-tauri/src/checkpoints.rs`)

Shells out to the system `git` in the **project's own repo** (`DESIGN §3.1` — this reverses the earlier shadow-repo
design; read that section before changing anything here). `current_dir` is pinned to the *repo root*, not the project
dir, because pathspecs resolve against the process cwd and the project may be a subdirectory of the repo. Commits are
**active-file-only** and land on the checked-out branch.

Four rules exist because this is real, pushable history, and each one has a test:

* Commits are assembled in a **scratch index** (`GIT_INDEX_FILE`), never `git add`, so other paths' staged work survives.
  Afterwards the real index entry for *that path only* is moved to the new blob — `sync_index` explains why leaving it
  stale is not an option (it makes `git status` report a phantom staged reversal).
* Committing is **refused** while HEAD is detached or a rebase/merge/cherry-pick/revert/bisect is in progress.
* **Gitignored files are never committed.**
* Commits use the user's identity and are **never signed** (a passphrase prompt would block an autosave). `commit-tree`
  runs no hooks, deliberately.

Two creation paths, and the difference matters:

* `create` — commits what is on disk.
* `create_from_content` — hashes a blob straight into the object database and builds a commit with `commit-tree`, without
  touching the working tree. This is what makes an incoming external write recoverable: by the time the watcher fires,
  the bytes worth saving exist only in the editor buffer.

Restore is `read_blob` + a frontend write, *not* `git checkout -- <path>`: routing it through the editor's save path is
what lets `lastWrite` suppress the watcher echo, and it leaves the index alone.

`src-tauri/tests/checkpoints.rs` covers all of this against throwaway repos; it is the one place where a bug silently
destroys the user's writing or their staged work, so extend those tests with any change here.

### Theming

Two independent mechanisms, both DOM-level:

* Markdown styling is generated as stylesheet text by `themeCss()` and injected into a `<style id="md-theme">` — not
  inline styles, since ProseMirror creates and destroys nodes as you type. The selectors in `editorSettings.ts` are
  written against the DOM Crepe actually produces (code blocks are CodeMirror instances, paragraphs carry Crepe's own
  size) and must out-specify Crepe's rules.
* Crepe's light/dark themes are separate stylesheets defining the same variables, so `lib/theme.ts` swaps the `href` of a
  single `<link id="crepe-theme">`. Never statically import a Crepe theme CSS file — that pins one variant.

### Terminal

`components/Terminal.tsx` is one xterm + one PTY per tab, mounted once and hidden (not unmounted) when inactive so
scrollback and running processes survive tab switches. Two timing constraints, both found by testing:
`startupCommand` is resolved when the tab is *created* and stored on the `TerminalTab` (a mount-time settings read loses
the race), and it is written to the PTY only after the shell's first output (an earlier write is discarded as
type-ahead). `fit()` produces NaN when the host is collapsed or hidden, hence the size guards.

## Conventions

Comments here explain rationale, not mechanics — they record the failure mode that motivated the code, often citing
`DESIGN §x`. Match that: if a line exists because of a non-obvious platform or library behavior, say which.

Copyright years use 2026.
