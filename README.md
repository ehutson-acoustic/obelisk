# Obelisk

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
`.obelisk/git`, so your project's own history stays clean. Checkpoints fire manually, before an external change lands
on an open file, and periodically while the buffer is dirty (default 5 min). Titles are generated from the diff
(`Edit 'Installation' in README.md (+12/−3)`) and are editable. Restore commits the current state first, then checks the
old version forward — history stays linear, nothing is stranded.

Inspect them with plain git:

```bash
git --git-dir=.obelisk/git --work-tree=. log
```

**Session** — projects, open tabs, per-file cursor and scroll, panel sizes, collapse states, and terminal tabs all
restore on launch.

**Opens from the OS** — double-click a `.md` in Finder or `xdg-open` it and Obelisk opens it, adopting the nearest
configured project or deriving one from the file's git repository root. See
[Default Markdown editor](#default-markdown-editor).

## Requirements

* Node 22.12+ and pnpm 10 (`corepack enable pnpm` picks up the version pinned in `package.json`)
* Rust 1.94+
* `git` on `PATH` (checkpoints are disabled with a notice if it's missing)
* Linux or macOS. Windows isn't targeted; the PTY layer is where it would need work.

Verified on Ubuntu 24.04 with webkit2gtk 4.1.

## Development

```bash
pnpm install
pnpm dev           # run the app
pnpm test          # vitest unit tests
pnpm build         # bundle for the current platform
```

### All scripts

| Script | What it does |
| --- | --- |
| `pnpm dev` | Run the app (Tauri + Vite with HMR) |
| `pnpm dev:web` | Vite alone in a browser — UI work without waiting on Rust |
| `pnpm build` | Bundle for the current platform |
| `pnpm build:web` | Typecheck and build the frontend only |
| `pnpm test` | Vitest unit tests, single run |
| `pnpm test:watch` | Vitest in watch mode |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm rust:fmt` | Format the Rust sources |
| `pnpm rust:fmt:check` | Fail if Rust sources need formatting |
| `pnpm rust:clippy` | Clippy with warnings denied |
| `pnpm rust:test` | Rust integration tests |
| `pnpm check` | Everything CI runs, in one command |
| `pnpm clean` | Remove `dist`, the Vite cache, and `src-tauri/target` |

Run `pnpm check` before opening a PR — it runs the same gates as CI.

Rust integration tests live in `src-tauri/tests` and cover the checkpoint → edit → restore → verify path.
`pnpm rust:test` runs them from the repo root; `cd src-tauri && cargo test` also works.

## Releases

`.github/workflows/ci.yml` runs typecheck, Vitest, `cargo fmt --check`, Clippy, and the Rust tests on every
push to `main` and every PR.

Pushing a `v*` tag runs `.github/workflows/release.yml`, which bundles macOS (universal `.dmg`) and Linux
(`.deb` + `.AppImage`) and attaches them to a **draft** GitHub Release:

```bash
git tag v0.1.0 && git push origin v0.1.0
```

Review the draft and publish it manually. `workflow_dispatch` builds the same bundles as downloadable
artifacts without creating a release.

Per-platform bundle targets live in `src-tauri/tauri.linux.conf.json` and `src-tauri/tauri.macos.conf.json`,
which Tauri merges over `tauri.conf.json`. macOS bundles are currently **unsigned and un-notarized**, so
Gatekeeper will warn on first open; `release.yml` has the signing env vars stubbed out ready to enable.

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

* **App settings** — `settings.json` in the OS config dir (`~/.config/Obelisk` on Linux). Currently: appearance
  (light/dark/system).
* **Project settings** — `.obelisk/settings.json`, stored sparsely; absent keys inherit the app default. Currently,
  read: `terminalStartupCommand`,
  `checkpointIntervalMinutes`, `theme`.

Obelisk offers once to add `.obelisk/git/` to your project's `.gitignore`
and never edits it silently. `settings.json` stays committable.

## Default Markdown editor

Obelisk declares itself a handler for `.md`, `.markdown` and `.mdx`. The declaration only exists in an **installed**
bundle — a `pnpm dev` binary is invisible to the OS's association database.

Once it's installed, the one-click route is **Settings → System → Make Obelisk the default**, on both platforms. The rest
of this section is what that button does, and what to try when the OS ignores it.

### macOS

```bash
pnpm build
cp -R src-tauri/target/release/bundle/macos/Obelisk.app /Applications/
```

Registration happens on its own from there — LaunchServices picks up new bundles in `/Applications`, and launching the
app registers it in any case. Being *offered* as a handler is automatic; being the *default* is a choice macOS reserves
for you. Make it, either in Finder — Get Info on a `.md`, *Open with* → Obelisk → **Change All…** — or directly:

```bash
brew install duti
duti -s com.ehutson.obelisk net.daringfireball.markdown all
```

If Finder keeps opening something else, in the order worth trying:

1. Delete any other copy of `Obelisk.app` — including the one left under `src-tauri/target/` — since LaunchServices picks
   between duplicates unpredictably.
2. Clear the per-file override, if you once pointed that particular file at another app with *Always Open With*. It
   survives every change of global default.
3. Re-register the bundle, which is a repair step rather than part of installing:
   ```bash
   /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
     -f /Applications/Obelisk.app
   ```
4. Rebuild the whole database, then restart Finder: `lsregister -kill -r -domain local -domain user`.

A DMG cannot automate any of this. Mounted images do not execute code on macOS by design, and `.pkg` — the one format
with an install script — isn't a Tauri bundle target.

### Linux

Installing the `.deb` registers the MIME type. Then make it the default:

```bash
update-desktop-database ~/.local/share/applications
xdg-mime default Obelisk.desktop text/markdown text/x-markdown
xdg-mime query default text/markdown        # verify
```

Set both `text/markdown` and the legacy `text/x-markdown` — which one a desktop environment consults varies.

For the AppImage there is no install step, so write the desktop entry by hand into
`~/.local/share/applications/obelisk.desktop`:

```ini
[Desktop Entry]
Type=Application
Name=Obelisk
Exec=/path/to/Obelisk.AppImage %F
Icon=obelisk
Terminal=false
Categories=Utility;TextEditor;
MimeType=text/markdown;text/x-markdown;
```

The `%F` matters: without it the file path is never passed and Obelisk opens empty.

## Stack

Tauri v2 · Rust · React 19 · Vite · TypeScript · Milkdown/Crepe · CodeMirror 6 · xterm.js + tauri-pty · Radix ·
react-resizable-panels
