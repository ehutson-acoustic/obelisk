import {invoke} from "@tauri-apps/api/core";
import {exists, watch} from "@tauri-apps/plugin-fs";
import {GitCommitVertical, PanelRightClose, PanelRightOpen} from "lucide-react";
import type {RefObject} from "react";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Group, type Layout, Panel, type PanelImperativeHandle, Separator, usePanelRef,} from "react-resizable-panels";
import {BranchMenu, type BranchTarget} from "./components/BranchMenu";
import {CheckpointDialog} from "./components/CheckpointDialog";
import {EditorPane} from "./components/EditorPane";
import {FileTabs} from "./components/FileTabs";
import {OpenFilesMenu} from "./components/OpenFilesMenu";
import {ProjectSettingsDialog} from "./components/ProjectSettingsDialog";
import {ProjectSidebar} from "./components/ProjectSidebar";
import {SettingsDialog} from "./components/SettingsDialog";
import {SidePanel} from "./components/SidePanel";
import {StatusBar} from "./components/StatusBar";
import {TerminalPanel} from "./components/TerminalPanel";
import {type AppSettings, DEFAULT_APP_SETTINGS, loadAppSettings, saveAppSettings,} from "./lib/appSettings";
import {
    type Branches,
    type Checkpoint,
    checkpointContent,
    checkpointFromContent,
    checkpointStatus,
    type CheckpointStatus,
    createBranch,
    createCheckpoint,
    gitAvailable,
    listBranches,
    listCheckpoints,
    repoState,
    type RepoState,
    stashChanges,
    switchBranch,
    trackBranch,
} from "./lib/checkpoints";
import {checkpointTitle} from "./lib/checkpointTitle";
import {
    DEFAULT_ZOOM,
    type EditorSettings,
    mergeSettings,
    paletteCss,
    type ProjectOverrides,
    resolveComponents,
    stepZoom,
    themeCss,
    themeDef,
} from "./lib/editorSettings";
import type {FindApi} from "./lib/find";
import {basename, dirname, isMarkdown, readFile, writeFile} from "./lib/files";
import type {DiagramStyle} from "./lib/mermaid";
import {loadProjectSettings} from "./lib/projectSettings";
import {loadSession, saveSession} from "./lib/session";
import {applyTheme, injectStyle, resolveTheme, type Theme, watchSystemTheme,} from "./lib/theme";
import {DEFAULT_SESSION, type EditorMode, type Project, type Session,} from "./types";

const AUTOSAVE_MS = 1000;
const NO_BRANCHES: Branches = {
    current: null,
    defaultBranch: null,
    local: [],
    remote: [],
};
/** Terminal tab bar height; also the panel's collapsed size, so the bar
 *  (and its expand toggle) stays visible when the panel is closed. */
const TERM_BAR_H = 32;

export default function App() {
    const [session, setSession] = useState<Session>(DEFAULT_SESSION);
    const [ready, setReady] = useState(false);
    const [content, setContent] = useState("");
    const [revision, setRevision] = useState(0);
    const [dirty, setDirty] = useState(false);
    const [conflict, setConflict] = useState<string | null>(null);
    const [status, setStatus] = useState<string | null>(null);
    const [shell, setShell] = useState<string | null>(null);
    const [appSettings, setAppSettings] =
        useState<AppSettings>(DEFAULT_APP_SETTINGS);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [theme, setTheme] = useState<Theme>(() =>
        resolveTheme(DEFAULT_APP_SETTINGS.appearance),
    );
    const [filesCollapsed, setFilesCollapsed] = useState(false);
    const [gitOk, setGitOk] = useState(true);
    const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
    const [ckptBusy, setCkptBusy] = useState(false);
    const [ckptError, setCkptError] = useState<string | null>(null);
    const [ckptDialog, setCkptDialog] = useState({open: false, suggestion: ""});
    /** Repo state and the active file's git status, refreshed together. */
    const [repo, setRepo] = useState<RepoState | null>(null);
    const [branches, setBranches] = useState<Branches>(NO_BRANCHES);
    const [fileStatus, setFileStatus] = useState<CheckpointStatus | null>(null);
    const [projectOverrides, setProjectOverrides] = useState<ProjectOverrides>({});
    const [projectSettingsFor, setProjectSettingsFor] = useState<Project | null>(
        null,
    );
    /** Published by whichever editor view is mounted (DESIGN §8.1). */
    const [findApi, setFindApi] = useState<FindApi | null>(null);
    const [findOpen, setFindOpen] = useState(false);
    const [findReplace, setFindReplace] = useState(false);

    const leftPanel = usePanelRef();
    const rightPanel = usePanelRef();
    const termPanel = usePanelRef();
    const filesPanel = usePanelRef();
    const scrollHost = useRef<HTMLDivElement>(null);
    const tabStrip = useRef<HTMLDivElement>(null);
    const sidebarEl = useRef<HTMLDivElement>(null);
    /** Content of our own most recent write, so the watcher can ignore the echo. */
    const lastWrite = useRef<string | null>(null);
    const saveTimer = useRef<number | null>(null);
    const cursorTimer = useRef<number | null>(null);
    /** Read by the periodic checkpoint timer without resetting it per keystroke. */
    const dirtyRef = useRef(false);
    const contentRef = useRef("");

    const activePath = session.activeFilePath;
    const activeProject = useMemo(
        () => session.projects.find((p) => p.id === session.activeProjectId) ?? null,
        [session.projects, session.activeProjectId],
    );
    const readOnly = !!activePath && !isMarkdown(activePath);
    const activeFile = session.openFiles.find((f) => f.path === activePath);

    const patch = useCallback(
        (p: Partial<Session>) => setSession((s) => ({...s, ...p})),
        [],
    );

    // ---- session load / save -------------------------------------------------

    useEffect(() => {
        loadSession().then((s) => {
            setSession(s);
            setReady(true);
        });
    }, []);

    useEffect(() => {
        if (!ready) return;
        const t = globalThis.setTimeout(() => saveSession(session), 300);
        return () => globalThis.clearTimeout(t);
    }, [session, ready]);

    // Apply persisted collapse states once the panels exist.
    useEffect(() => {
        if (!ready) return;
        if (session.leftCollapsed) leftPanel.current?.collapse();
        if (session.rightCollapsed) rightPanel.current?.collapse();
        if (session.terminalCollapsed) termPanel.current?.collapse();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ready]);

    /**
     * The header spans the full width but its tabs should line up with the
     * editor, so they're offset by the live width of the left sidebar. Measured
     * off the element itself, one task after the event: during a layout callback
     * the panel handle still reports the width from *before* the collapse or
     * expand, which left the offset one step behind and reading as though it
     * were inverted. Written straight to a CSS variable to keep dragging smooth
     * — React state would re-render the tree on every pointer move.
     */
    const syncLeftWidth = useCallback(() => {
        globalThis.setTimeout(() => {
            const el = sidebarEl.current;
            if (!el) return;
            document.documentElement.style.setProperty(
                "--left-w",
                `${Math.round(el.getBoundingClientRect().width)}px`,
            );
        }, 0);
    }, []);

    useEffect(() => {
        syncLeftWidth();
        window.addEventListener("resize", syncLeftWidth);
        return () => window.removeEventListener("resize", syncLeftWidth);
    }, [syncLeftWidth, ready]);

    /** v4 has no per-panel collapse callback, so read the refs after a drag. */
    const syncCollapsed = useCallback(() => {
        setFilesCollapsed(filesPanel.current?.isCollapsed() ?? false);
        setSession((s) => ({
            ...s,
            leftCollapsed: leftPanel.current?.isCollapsed() ?? s.leftCollapsed,
            rightCollapsed: rightPanel.current?.isCollapsed() ?? s.rightCollapsed,
            terminalCollapsed:
                termPanel.current?.isCollapsed() ?? s.terminalCollapsed,
        }));
    }, [leftPanel, rightPanel, termPanel, filesPanel]);

    const onLayoutChanged = useCallback(
        (groupId: string) => (layout: Layout) => {
            setSession((s) => ({
                ...s,
                layouts: {...s.layouts, [groupId]: layout},
            }));
            syncCollapsed();
            syncLeftWidth();
        },
        [syncCollapsed, syncLeftWidth],
    );

    // ---- appearance ----------------------------------------------------------

    useEffect(() => {
        loadAppSettings().then(setAppSettings);
    }, []);

    useEffect(() => {
        const apply = () => {
            const next = resolveTheme(appSettings.appearance);
            setTheme(next);
            applyTheme(next);
        };
        apply();
        if (appSettings.appearance !== "system") return;
        return watchSystemTheme(apply);
    }, [appSettings.appearance]);

    const updateSettings = useCallback((next: AppSettings) => {
        setAppSettings(next);
        saveAppSettings(next);
    }, []);

    /** App defaults with the active project's overrides applied (DESIGN §5.2). */
    const editorSettings: EditorSettings = useMemo(
        () => mergeSettings(appSettings.editor, projectOverrides),
        [appSettings.editor, projectOverrides],
    );

    // Markdown styling is injected as a stylesheet rather than inline styles, so
    // it applies to nodes ProseMirror creates and destroys as you type.
    useEffect(() => {
        injectStyle("md-theme", themeCss(editorSettings));
    }, [editorSettings]);

    // The theme's palette overrides the `:root` variables styles.css declares
    // (DESIGN §5.3). Separate from md-theme so a theme switch does not rewrite
    // the Markdown sheet, and vice versa.
    useEffect(() => {
        injectStyle("app-palette", paletteCss(editorSettings));
    }, [editorSettings]);

    /**
     * Mermaid diagrams are the one thing a theme switch cannot restyle through a
     * stylesheet — mermaid resolves colours while it lays a diagram out and
     * writes them into the SVG (DESIGN §2.6) — so the values it needs are passed
     * down as data rather than left to CSS.
     */
    const diagramStyle: DiagramStyle = useMemo(() => {
        const body = resolveComponents(editorSettings).body;
        return {
            theme,
            palette: themeDef(editorSettings.theme)[theme],
            fontFamily: body.fontFamily ?? "",
            fontSize: body.fontSize ?? "",
        };
    }, [editorSettings, theme]);

    /**
     * Set on the root rather than the editor panel: `--content-width` is declared
     * at `:root` in terms of this, so scoping it lower would leave the measure
     * reading the fallback. Nothing outside the editor's own rules refers to it,
     * so app chrome stays put (DESIGN §7).
     */
    useEffect(() => {
        document.documentElement.style.setProperty(
            "--editor-zoom",
            String(session.editorZoom ?? DEFAULT_ZOOM),
        );
    }, [session.editorZoom]);

    const toggle = (
        ref: RefObject<PanelImperativeHandle | null>,
        key: "leftCollapsed" | "rightCollapsed" | "terminalCollapsed",
    ) => {
        const p = ref.current;
        if (!p) return;
        const collapsed = p.isCollapsed();
        if (collapsed) p.expand();
        else p.collapse();
        patch({[key]: !collapsed} as Partial<Session>);
        syncLeftWidth();
    };

    /** Unlike the other three, this collapse is view state and is not persisted. */
    const toggleFilesPanel = useCallback(() => {
        const p = filesPanel.current;
        if (!p) return;
        const wasCollapsed = p.isCollapsed();
        if (wasCollapsed) p.expand();
        else p.collapse();
        setFilesCollapsed(!wasCollapsed);
    }, [filesPanel]);

    // ---- terminals -----------------------------------------------------------

    useEffect(() => {
        invoke<string>("default_shell")
            .then(setShell)
            .catch(() => setShell("/bin/sh"));
    }, []);

    const addTerminal = useCallback(async () => {
        if (!activeProject) {
            setStatus("Select a project first");
            return;
        }
        const id = crypto.randomUUID();
        const startupCommand = editorSettings.terminalStartupCommand.trim();
        setSession((s) => ({
            ...s,
            terminals: [
                ...s.terminals,
                {
                    id,
                    title: `Terminal ${s.terminals.length + 1}`,
                    cwd: activeProject.dir,
                    startupCommand: startupCommand || undefined,
                },
            ],
            activeTerminalId: id,
        }));
    }, [activeProject, editorSettings.terminalStartupCommand]);

    const closeTerminal = useCallback((id: string) => {
        setSession((s) => {
            const terminals = s.terminals.filter((t) => t.id !== id);
            return {
                ...s,
                terminals,
                activeTerminalId:
                    s.activeTerminalId === id
                        ? (terminals[terminals.length - 1]?.id ?? null)
                        : s.activeTerminalId,
            };
        });
    }, []);

    const toggleTerminalPanel = () => {
        const p = termPanel.current;
        if (!p) return;
        const collapsed = p.isCollapsed();
        if (collapsed) {
            p.expand();
            if (session.terminals.length === 0) addTerminal();
        } else {
            p.collapse();
        }
        patch({terminalCollapsed: !collapsed});
    };

    // ---- open / load ---------------------------------------------------------

    const loadInto = useCallback(async (path: string) => {
        try {
            const text = await readFile(path);
            lastWrite.current = text;
            setContent(text);
            setDirty(false);
            setConflict(null);
            setRevision((r) => r + 1);
        } catch (err) {
            setStatus(`Could not open ${basename(path)}: ${err}`);
        }
    }, []);

    const openFile = useCallback((path: string) => {
        setSession((s) => ({
            ...s,
            activeFilePath: path,
            openFiles: s.openFiles.some((f) => f.path === path)
                ? s.openFiles
                : [...s.openFiles, {path}],
        }));
    }, []);

    /**
     * Opens a search hit. This forces **source** mode, because a line number only
     * means something there: ProseMirror positions count node boundaries, so the
     * same offset in WYSIWYG lands somewhere unrelated. Jumping to the right place
     * in the wrong mode is not on offer, and silently not jumping would read as a
     * broken result list (DESIGN §8.2).
     */
    const openAtLine = useCallback(
        async (path: string, line: number) => {
            let cursor = 0;
            try {
                const text = await readFile(path);
                const lines = text.split("\n");
                for (let i = 0; i < Math.min(line - 1, lines.length); i += 1) {
                    cursor += lines[i].length + 1;
                }
            } catch {
                // The file moved since the search ran; open it and let the normal
                // load path report the failure.
            }

            const already = activePath === path;
            setSession((s) => {
                const openFiles = s.openFiles.some((f) => f.path === path)
                    ? s.openFiles
                    : [...s.openFiles, {path}];
                return {
                    ...s,
                    mode: "source",
                    activeFilePath: path,
                    openFiles: openFiles.map((f) =>
                        f.path === path ? {...f, cursor, cursorMode: "source"} : f,
                    ),
                };
            });
            // Switching files reloads on its own, but re-opening the file already on
            // screen changes nothing the load effect watches — so the remount that
            // applies the cursor has to be forced.
            if (already) await loadInto(path);
        },
        [activePath, loadInto],
    );

    // Load whenever the active file changes, including the startup restore.
    useEffect(() => {
        if (!ready || !activePath) return;
        loadInto(activePath);
    }, [ready, activePath, loadInto]);

    // Restore scroll offset after a file loads.
    useEffect(() => {
        const saved = session.openFiles.find((f) => f.path === activePath)?.scroll;
        if (scrollHost.current) scrollHost.current.scrollTop = saved ?? 0;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [revision]);

    // With many files open the strip scrolls; keep the active tab reachable
    // without hunting for it.
    useEffect(() => {
        tabStrip.current
            ?.querySelector(".tab.active")
            ?.scrollIntoView({block: "nearest", inline: "nearest"});
    }, [activePath]);

    const closeFile = (path: string) => {
        setSession((s) => {
            const openFiles = s.openFiles.filter((f) => f.path !== path);
            const next =
                s.activeFilePath === path
                    ? (openFiles[openFiles.length - 1]?.path ?? null)
                    : s.activeFilePath;
            return {...s, openFiles, activeFilePath: next};
        });
    };

    const selectFile = useCallback(
        (path: string) => patch({activeFilePath: path}),
        [patch],
    );

    const onEditorScroll = useCallback((top: number) => {
        setSession((s) => ({
            ...s,
            openFiles: s.openFiles.map((f) =>
                f.path === s.activeFilePath ? {...f, scroll: top} : f,
            ),
        }));
    }, []);

    // ---- autosave ------------------------------------------------------------

    const flushSave = useCallback(async (text: string, path: string) => {
        try {
            lastWrite.current = text;
            await writeFile(path, text);
            setDirty(false);
        } catch (err) {
            setStatus(`Save failed: ${err}`);
        }
    }, []);

    const onChange = (text: string) => {
        setContent(text);
        if (readOnly || !activePath) return;
        setDirty(true);
        if (saveTimer.current) globalThis.clearTimeout(saveTimer.current);
        saveTimer.current = globalThis.setTimeout(
            () => flushSave(text, activePath),
            AUTOSAVE_MS,
        );
    };

    // Debounced so cursor movement doesn't re-render the tree on every keystroke.
    const onCursorChange = useCallback((pos: number) => {
        if (cursorTimer.current) globalThis.clearTimeout(cursorTimer.current);
        cursorTimer.current = globalThis.setTimeout(() => {
            setSession((s) => ({
                ...s,
                openFiles: s.openFiles.map((f) =>
                    f.path === s.activeFilePath
                        ? {...f, cursor: pos, cursorMode: s.mode}
                        : f,
                ),
            }));
        }, 400);
    }, []);

    // Ctrl/Cmd+S force-saves.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                e.preventDefault();
                if (activePath && !readOnly) {
                    if (saveTimer.current) globalThis.clearTimeout(saveTimer.current);
                    flushSave(content, activePath);
                }
            }
        };
        globalThis.addEventListener("keydown", onKey);
        return () => globalThis.removeEventListener("keydown", onKey);
    }, [activePath, content, readOnly, flushSave]);

    // ---- zoom ----------------------------------------------------------------

    const zoomBy = useCallback(
        (direction: number) => {
            setSession((s) => {
                const next =
                    direction === 0
                        ? DEFAULT_ZOOM
                        : stepZoom(s.editorZoom ?? DEFAULT_ZOOM, direction);
                setStatus(`Editor zoom ${Math.round(next * 100)}%`);
                return {...s, editorZoom: next};
            });
        },
        [],
    );

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!e.metaKey && !e.ctrlKey) return;
            // `=` is the unshifted key on the `+` cap, which is what Ctrl+= means
            // on every keyboard layout that matters here; `+` covers the shifted
            // form, and `_` the shifted `-`.
            if (e.key === "=" || e.key === "+") {
                e.preventDefault();
                zoomBy(1);
            } else if (e.key === "-" || e.key === "_") {
                e.preventDefault();
                zoomBy(-1);
            } else if (e.key === "0") {
                e.preventDefault();
                zoomBy(0);
            }
        };
        globalThis.addEventListener("keydown", onKey);
        return () => globalThis.removeEventListener("keydown", onKey);
    }, [zoomBy]);

    // ---- find ----------------------------------------------------------------

    const closeFind = useCallback(() => {
        setFindOpen(false);
        findApi?.close();
    }, [findApi]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!e.metaKey && !e.ctrlKey) return;
            const key = e.key.toLowerCase();
            if (key === "f" && e.shiftKey) {
                // Project-wide search lives in the side panel, so open both.
                e.preventDefault();
                rightPanel.current?.expand();
                setSession((s) => ({
                    ...s,
                    rightCollapsed: false,
                    sidePanel: "search",
                }));
            } else if (key === "f") {
                e.preventDefault();
                setFindOpen(true);
            } else if (key === "h") {
                e.preventDefault();
                setFindOpen(true);
                setFindReplace(true);
            }
        };
        globalThis.addEventListener("keydown", onKey);
        return () => globalThis.removeEventListener("keydown", onKey);
    }, [rightPanel]);

    // ---- checkpoints ---------------------------------------------------------

    // Read by timers and async callbacks that must not re-subscribe per keystroke.
    dirtyRef.current = dirty;
    contentRef.current = content;

    useEffect(() => {
        gitAvailable()
            .then(setGitOk)
            .catch(() => setGitOk(false));
    }, []);

    useEffect(() => {
        if (!activeProject) {
            setProjectOverrides({});
            return;
        }
        loadProjectSettings(activeProject.dir).then(setProjectOverrides);
    }, [activeProject]);

    /**
     * History, the file's git status, and the repo's own state travel together:
     * `blocked` can start being true because of something done in the terminal,
     * so the Checkpoint button has to re-check rather than trust a cached answer.
     */
    const refreshCheckpoints = useCallback(async () => {
        if (!activeProject || !gitOk) {
            setCheckpoints([]);
            setFileStatus(null);
            setRepo(null);
            return;
        }
        try {
            setRepo(await repoState(activeProject.dir));
        } catch {
            setRepo(null);
        }
        if (!activePath) {
            setCheckpoints([]);
            setFileStatus(null);
            return;
        }
        try {
            const [history, status] = await Promise.all([
                listCheckpoints(activeProject.dir, activePath),
                checkpointStatus(activeProject.dir, activePath),
            ]);
            setCheckpoints(history);
            setFileStatus(status);
            setCkptError(null);
        } catch (err) {
            setCkptError(String(err));
        }
    }, [activeProject, activePath, gitOk]);

    const refreshBranches = useCallback(async () => {
        if (!activeProject || !gitOk) {
            setBranches(NO_BRANCHES);
            return;
        }
        try {
            setBranches(await listBranches(activeProject.dir));
        } catch {
            setBranches(NO_BRANCHES);
        }
    }, [activeProject, gitOk]);

    useEffect(() => {
        refreshBranches();
    }, [refreshBranches]);

    useEffect(() => {
        refreshCheckpoints();
    }, [refreshCheckpoints, revision]);

    const suggestTitle = useCallback(async () => {
        if (!activeProject || !activePath) return "Checkpoint";
        const status = await checkpointStatus(activeProject.dir, activePath);
        return checkpointTitle({
            fileName: basename(activePath),
            content: contentRef.current,
            diff: status.diff,
            tracked: status.tracked,
        });
    }, [activeProject, activePath]);

    const openCheckpointDialog = useCallback(async () => {
        if (!activeProject || !activePath) return;
        try {
            setCkptDialog({open: true, suggestion: await suggestTitle()});
        } catch (err) {
            setCkptError(String(err));
        }
    }, [activeProject, activePath, suggestTitle]);

    const confirmCheckpoint = useCallback(
        async (title: string) => {
            if (!activeProject || !activePath) return;
            setCkptDialog({open: false, suggestion: ""});
            setCkptBusy(true);
            try {
                // Flush any pending autosave so the commit matches what's on screen.
                if (saveTimer.current) globalThis.clearTimeout(saveTimer.current);
                await flushSave(contentRef.current, activePath);
                const short = await createCheckpoint(
                    activeProject.dir,
                    activePath,
                    title,
                );
                setStatus(short ? `Checkpoint ${short}` : "No changes to checkpoint");
                await refreshCheckpoints();
            } catch (err) {
                setCkptError(String(err));
            } finally {
                setCkptBusy(false);
            }
        },
        [activeProject, activePath, flushSave, refreshCheckpoints],
    );

    const handleRestore = useCallback(
        async (checkpoint: Checkpoint) => {
            if (!activeProject || !activePath) return;
            setCkptBusy(true);
            try {
                // Preserve what's on screen first, so no restore is ever destructive
                // and history stays linear (DESIGN §3.6).
                await checkpointFromContent(
                    activeProject.dir,
                    activePath,
                    contentRef.current,
                    `Before restoring ${checkpoint.short}`,
                );
                // Written here rather than by `git checkout` so the write goes
                // through `lastWrite` and the watcher ignores its own echo.
                const text = await checkpointContent(
                    activeProject.dir,
                    activePath,
                    checkpoint.sha,
                );
                await flushSave(text, activePath);
                await loadInto(activePath);
                await refreshCheckpoints();
                setStatus(`Restored ${checkpoint.short}`);
            } catch (err) {
                setCkptError(String(err));
            } finally {
                setCkptBusy(false);
            }
        },
        [activeProject, activePath, flushSave, loadInto, refreshCheckpoints],
    );

    // Periodic checkpoint while dirty.
    useEffect(() => {
        if (!activeProject || !activePath || !gitOk) return;
        const id = globalThis.setInterval(
            async () => {
                if (!dirtyRef.current) return;
                try {
                    const short = await createCheckpoint(
                        activeProject.dir,
                        activePath,
                        await suggestTitle(),
                    );
                    if (short) await refreshCheckpoints();
                } catch {
                    /* transient; the next tick tries again */
                }
            },
            Math.max(1, editorSettings.checkpointIntervalMinutes) * 60_000,
        );
        return () => globalThis.clearInterval(id);
    }, [
        activeProject,
        activePath,
        gitOk,
        editorSettings.checkpointIntervalMinutes,
        suggestTitle,
        refreshCheckpoints,
    ]);

    // ---- branches ------------------------------------------------------------

    /**
     * Never let a branch operation be the reason writing is lost. Only the active
     * file has an in-memory buffer, so it is the only one that can be dirty.
     */
    const secureActiveBuffer = useCallback(
        async (reason: string) => {
            if (!activeProject || !activePath || !gitOk || !dirtyRef.current) return;
            if (saveTimer.current) globalThis.clearTimeout(saveTimer.current);
            await flushSave(contentRef.current, activePath);
            await checkpointFromContent(
                activeProject.dir,
                activePath,
                contentRef.current,
                reason,
            ).catch(() => {
                /* blocked repo states are reported by the switch itself */
            });
        },
        [activeProject, activePath, gitOk, flushSave],
    );

    /**
     * A switch rewrites the working tree, so open tabs may have new content or
     * have stopped existing. Reuses the normal reload path for the former and
     * closes tabs for the latter, but only for files inside this project.
     */
    const afterBranchChange = useCallback(
        async (message: string) => {
            if (!activeProject) return;
            await Promise.all([refreshBranches(), refreshCheckpoints()]);

            const owned = session.openFiles.filter((f) =>
                f.path.startsWith(activeProject.dir),
            );
            const checked = await Promise.all(
                owned.map(async (f) => ({
                    path: f.path,
                    gone: !(await exists(f.path).catch(() => true)),
                })),
            );
            const gone = new Set(checked.filter((c) => c.gone).map((c) => c.path));

            if (gone.size > 0) {
                setSession((s) => {
                    const openFiles = s.openFiles.filter((f) => !gone.has(f.path));
                    return {
                        ...s,
                        openFiles,
                        activeFilePath:
                            s.activeFilePath && gone.has(s.activeFilePath)
                                ? (openFiles[openFiles.length - 1]?.path ?? null)
                                : s.activeFilePath,
                    };
                });
            }
            if (activePath && !gone.has(activePath)) await loadInto(activePath);

            const closed =
                gone.size > 0
                    ? ` — closed ${gone.size} file${gone.size === 1 ? "" : "s"} not on this branch`
                    : "";
            setStatus(`${message}${closed}`);
        },
        [
            activeProject,
            activePath,
            session.openFiles,
            loadInto,
            refreshBranches,
            refreshCheckpoints,
        ],
    );

    /** Rejects with git's message so the dropdown can offer to stash. */
    const switchTo = useCallback(
        async (target: BranchTarget) => {
            if (!activeProject) return;
            await secureActiveBuffer("Before switching branches");
            if (target.reference) {
                await trackBranch(activeProject.dir, target.reference);
            } else {
                await switchBranch(activeProject.dir, target.name);
            }
            await afterBranchChange(`Switched to ${target.name}`);
        },
        [activeProject, secureActiveBuffer, afterBranchChange],
    );

    const createAndSwitch = useCallback(
        async (name: string) => {
            if (!activeProject) return;
            await secureActiveBuffer("Before creating a branch");
            await createBranch(activeProject.dir, name);
            await afterBranchChange(`Created ${name}`);
        },
        [activeProject, secureActiveBuffer, afterBranchChange],
    );

    const stashFor = useCallback(
        async (label: string) => {
            if (!activeProject) return;
            const stashed = await stashChanges(activeProject.dir, label);
            if (stashed) setStatus("Stashed local changes");
        },
        [activeProject],
    );

    // ---- external changes ----------------------------------------------------

    useEffect(() => {
        if (!activePath) return;
        let unwatch: (() => void) | undefined;
        let cancelled = false;

        watch(
            activePath,
            async () => {
                try {
                    const text = await readFile(activePath);
                    if (text === lastWrite.current || text === content) return;
                    if (dirty) {
                        setConflict(text);
                    } else {
                        // The incoming bytes are already on disk, so the state worth
                        // keeping exists only in the buffer — commit it from memory
                        // before it's replaced (DESIGN §3.4).
                        if (activeProject && gitOk && content) {
                            await checkpointFromContent(
                                activeProject.dir,
                                activePath,
                                content,
                                `Before external change to ${basename(activePath)}`,
                            ).catch(() => {
                            });
                        }
                        lastWrite.current = text;
                        setContent(text);
                        setRevision((r) => r + 1);
                    }
                } catch {
                    /* file may be mid-replace; the next event settles it */
                }
            },
            {delayMs: 150},
        ).then((fn) => {
            if (cancelled) fn();
            else unwatch = fn;
        });

        return () => {
            cancelled = true;
            unwatch?.();
        };
    }, [activePath, dirty, content, activeProject, gitOk]);

    const acceptExternal = () => {
        if (conflict == null) return;
        lastWrite.current = conflict;
        setContent(conflict);
        setRevision((r) => r + 1);
        setDirty(false);
        setConflict(null);
    };

    const keepMine = () => {
        setConflict(null);
        if (activePath) flushSave(content, activePath);
    };

    // ---- footer actions ------------------------------------------------------

    const copyContents = async () => {
        try {
            await navigator.clipboard.writeText(content);
            setStatus("Copied file contents");
        } catch (err) {
            setStatus(`Copy failed: ${err}`);
        }
    };

    useEffect(() => {
        if (!status) return;
        const t = globalThis.setTimeout(() => setStatus(null), 3000);
        return () => globalThis.clearTimeout(t);
    }, [status]);

    /**
     * Everything that makes checkpointing unavailable, as the reason to show in
     * the button's tooltip. A gitignored file is refused by Rust anyway, so
     * saying why up front beats letting the click fail.
     */
    const checkpointBlockedReason = useMemo(() => {
        if (!gitOk) return "git was not found on PATH";
        if (fileStatus?.ignored) return "This file is excluded by .gitignore";
        // A missing repo is not a blocker: the first checkpoint creates one.
        if (repo?.repo && repo.blocked) return `Unavailable while ${repo.blocked}`;
        return null;
    }, [gitOk, fileStatus?.ignored, repo]);

    // ---- render --------------------------------------------------------------

    return (
        <div className="app">
            <header className="header">
                <FileTabs
                    files={session.openFiles}
                    activePath={activePath}
                    dirty={dirty}
                    stripRef={tabStrip}
                    onSelect={selectFile}
                    onClose={closeFile}
                />
                <div className="header-actions">
                    <OpenFilesMenu
                        files={session.openFiles}
                        activePath={activePath}
                        onSelect={selectFile}
                    />
                    <BranchMenu
                        state={repo}
                        branches={branches}
                        busy={ckptBusy}
                        disabled={!activeProject || !gitOk || !repo?.repo}
                        onOpen={refreshBranches}
                        onSwitch={switchTo}
                        onCreate={createAndSwitch}
                        onStash={stashFor}
                    />
                    <button
                        className="btn"
                        title={checkpointBlockedReason ?? "Create a checkpoint"}
                        disabled={
                            !activePath || !activeProject || ckptBusy || !!checkpointBlockedReason
                        }
                        onClick={openCheckpointDialog}
                    >
                        <GitCommitVertical size={14}/> Checkpoint
                    </button>
                    <button
                        className="icon-btn"
                        onClick={() => toggle(rightPanel, "rightCollapsed")}
                        title={
                            session.rightCollapsed
                                ? "Show right sidebar"
                                : "Hide right sidebar"
                        }
                    >
                        {session.rightCollapsed ? (
                            <PanelRightOpen size={16}/>
                        ) : (
                            <PanelRightClose size={16}/>
                        )}
                    </button>
                </div>
            </header>

            <Group
                id="outer"
                orientation="horizontal"
                className="main"
                defaultLayout={session.layouts.outer}
                onLayoutChange={syncLeftWidth}
                onLayoutChanged={onLayoutChanged("outer")}
            >
                <Panel
                    panelRef={leftPanel}
                    id="left"
                    defaultSize="18"
                    minSize={170}
                    collapsible
                    collapsedSize={56}
                >
                    <ProjectSidebar
                        hostRef={sidebarEl}
                        projects={session.projects}
                        activeId={session.activeProjectId}
                        collapsed={session.leftCollapsed}
                        onSelect={(id) => patch({activeProjectId: id})}
                        onChange={(projects: Project[]) => patch({projects})}
                        onToggleCollapse={() => toggle(leftPanel, "leftCollapsed")}
                        onOpenAppSettings={() => setSettingsOpen(true)}
                        onOpenProjectSettings={setProjectSettingsFor}
                    />
                </Panel>

                <Separator className="handle vertical"/>

                <Panel id="center">
                    <div className="center-col">
                        <Group
                            id="center"
                            orientation="vertical"
                            className="center-group"
                            defaultLayout={session.layouts.center}
                            onLayoutChanged={onLayoutChanged("center")}
                        >
                            <Panel id="editor">
                                <EditorPane
                                    path={activePath}
                                    revision={revision}
                                    mode={session.mode}
                                    theme={theme}
                                    diagramStyle={diagramStyle}
                                    zoom={session.editorZoom ?? DEFAULT_ZOOM}
                                    value={content}
                                    readOnly={readOnly}
                                    cursor={
                                        activeFile?.cursorMode === session.mode
                                            ? activeFile.cursor
                                            : undefined
                                    }
                                    conflict={conflict}
                                    findOpen={findOpen}
                                    findApi={findApi}
                                    findReplace={findReplace}
                                    scrollHostRef={scrollHost}
                                    onModeChange={(mode: EditorMode) => patch({mode})}
                                    onChange={onChange}
                                    onCursorChange={onCursorChange}
                                    onFindApi={setFindApi}
                                    onFindReplaceChange={setFindReplace}
                                    onFindClose={closeFind}
                                    onScroll={onEditorScroll}
                                    onAcceptExternal={acceptExternal}
                                    onKeepMine={keepMine}
                                />
                            </Panel>

                            {/* Thin grip so only the top edge drags — the tab bar below it
                  needs to stay clickable. */}
                            <Separator className="handle terminal-grip" disableDoubleClick/>

                            <Panel
                                panelRef={termPanel}
                                id="terminal"
                                defaultSize="30"
                                minSize={120}
                                collapsible
                                collapsedSize={TERM_BAR_H}
                            >
                                <TerminalPanel
                                    tabs={session.terminals}
                                    activeId={session.activeTerminalId}
                                    collapsed={session.terminalCollapsed}
                                    shell={shell}
                                    theme={theme}
                                    palette={themeDef(editorSettings.theme)[theme]}
                                    onSelect={(id) => patch({activeTerminalId: id})}
                                    onClose={closeTerminal}
                                    onAdd={addTerminal}
                                    onToggleCollapse={toggleTerminalPanel}
                                />
                            </Panel>
                        </Group>

                        <StatusBar
                            path={activePath}
                            status={status}
                            readOnly={readOnly}
                            onCopy={copyContents}
                            onNewFile={() =>
                                setStatus(
                                    `Use the Files panel — target ${dirname(activePath ?? "")}`,
                                )
                            }
                        />
                    </div>
                </Panel>

                <Separator className="handle vertical"/>

                <Panel
                    panelRef={rightPanel}
                    id="right"
                    defaultSize="26"
                    minSize={200}
                    collapsible
                    collapsedSize={0}
                >
                    <SidePanel
                        tab={session.sidePanel}
                        onTabChange={(sidePanel) => patch({sidePanel})}
                        root={activeProject?.dir ?? null}
                        activePath={activePath}
                        filesCollapsed={filesCollapsed}
                        filesPanelRef={filesPanel}
                        defaultLayout={session.layouts.side}
                        onLayoutChanged={onLayoutChanged("side")}
                        onOpen={openFile}
                        onOpenAtLine={openAtLine}
                        onToggleFiles={toggleFilesPanel}
                        versions={{
                            checkpoints,
                            hasFile: !!activePath && !!activeProject,
                            gitMissing: !gitOk,
                            noRepo: !!activeProject && gitOk && repo?.repo === false,
                            error: ckptError,
                            busy: ckptBusy,
                            checkpointsOnly: session.versionsCheckpointsOnly,
                            onCheckpointsOnlyChange: (value) =>
                                patch({versionsCheckpointsOnly: value}),
                            onRestore: handleRestore,
                        }}
                    />
                </Panel>
            </Group>

            <SettingsDialog
                open={settingsOpen}
                settings={appSettings}
                onChange={updateSettings}
                onOpenChange={setSettingsOpen}
            />

            <ProjectSettingsDialog
                project={projectSettingsFor}
                appEditor={appSettings.editor}
                onClose={() => setProjectSettingsFor(null)}
                onSaved={(overrides) => {
                    if (projectSettingsFor?.id === activeProject?.id) {
                        setProjectOverrides(overrides);
                    }
                    setStatus("Project settings saved");
                }}
            />

            <CheckpointDialog
                open={ckptDialog.open}
                suggestion={ckptDialog.suggestion}
                fileName={activePath ?? ""}
                branch={repo?.branch ?? null}
                staged={!!fileStatus?.staged}
                onConfirm={confirmCheckpoint}
                onOpenChange={(open) =>
                    setCkptDialog((d) => ({...d, open}))
                }
            />

        </div>
    );
}
