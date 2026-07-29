import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {invoke} from "@tauri-apps/api/core";
import {watch} from "@tauri-apps/plugin-fs";
import {
    ChevronDown,
    ChevronUp,
    Copy,
    FilePlus,
    GitCommitVertical,
    PanelRightClose,
    PanelRightOpen,
    Plus,
    TerminalSquare,
    X,
} from "lucide-react";
import type {RefObject} from "react";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Group, type Layout, Panel, type PanelImperativeHandle, Separator, usePanelRef,} from "react-resizable-panels";
import {BrandMark} from "./components/BrandMark";
import {CheckpointDialog} from "./components/CheckpointDialog";
import {Editor} from "./components/Editor";
import {FileBrowser} from "./components/FileBrowser";
import {FindBar} from "./components/FindBar";
import {SearchPanel} from "./components/SearchPanel";
import {ProjectSettingsDialog} from "./components/ProjectSettingsDialog";
import {ProjectSidebar} from "./components/ProjectSidebar";
import {SettingsDialog} from "./components/SettingsDialog";
import {TerminalView} from "./components/Terminal";
import {VersionsPanel} from "./components/VersionsPanel";
import {type AppSettings, DEFAULT_APP_SETTINGS, loadAppSettings, saveAppSettings,} from "./lib/appSettings";
import {
    type Checkpoint,
    checkpointFromContent,
    checkpointStatus,
    createCheckpoint,
    gitAvailable,
    listCheckpoints,
    restoreCheckpoint,
} from "./lib/checkpoints";
import {checkpointTitle} from "./lib/checkpointTitle";
import {
    DEFAULT_ZOOM,
    type EditorSettings,
    mergeSettings,
    paletteCss,
    type ProjectOverrides,
    stepZoom,
    themeCss,
    themeDef,
} from "./lib/editorSettings";
import type {FindApi} from "./lib/find";
import {basename, dirname, isMarkdown, readFile, writeFile} from "./lib/files";
import {addGitignoreEntry, needsGitignoreEntry} from "./lib/gitignore";
import {loadProjectSettings} from "./lib/projectSettings";
import {loadSession, saveSession} from "./lib/session";
import {applyTheme, injectStyle, resolveTheme, type Theme, watchSystemTheme,} from "./lib/theme";
import {DEFAULT_SESSION, type EditorMode, type Project, type Session,} from "./types";

const AUTOSAVE_MS = 1000;
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
    const [gitignoreAsk, setGitignoreAsk] = useState<string | null>(null);
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
        const t = window.setTimeout(() => saveSession(session), 300);
        return () => window.clearTimeout(t);
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
        window.setTimeout(() => {
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
    // the markdown sheet, and vice versa.
    useEffect(() => {
        injectStyle("app-palette", paletteCss(editorSettings));
    }, [editorSettings]);

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
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(
            () => flushSave(text, activePath),
            AUTOSAVE_MS,
        );
    };

    // Debounced so cursor movement doesn't re-render the tree on every keystroke.
    const onCursorChange = useCallback((pos: number) => {
        if (cursorTimer.current) window.clearTimeout(cursorTimer.current);
        cursorTimer.current = window.setTimeout(() => {
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
                    if (saveTimer.current) window.clearTimeout(saveTimer.current);
                    flushSave(content, activePath);
                }
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
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
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
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
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
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

    const refreshCheckpoints = useCallback(async () => {
        if (!activeProject || !activePath || !gitOk) {
            setCheckpoints([]);
            return;
        }
        try {
            setCheckpoints(await listCheckpoints(activeProject.dir, activePath));
            setCkptError(null);
        } catch (err) {
            setCkptError(String(err));
        }
    }, [activeProject, activePath, gitOk]);

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
                if (saveTimer.current) window.clearTimeout(saveTimer.current);
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
                await restoreCheckpoint(activeProject.dir, activePath, checkpoint.sha);
                await loadInto(activePath);
                await refreshCheckpoints();
                setStatus(`Restored ${checkpoint.short}`);
            } catch (err) {
                setCkptError(String(err));
            } finally {
                setCkptBusy(false);
            }
        },
        [activeProject, activePath, loadInto, refreshCheckpoints],
    );

    // Periodic checkpoint while dirty.
    useEffect(() => {
        if (!activeProject || !activePath || !gitOk) return;
        const id = window.setInterval(
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
        return () => window.clearInterval(id);
    }, [
        activeProject,
        activePath,
        gitOk,
        editorSettings.checkpointIntervalMinutes,
        suggestTitle,
        refreshCheckpoints,
    ]);

    // Offer to keep checkpoint history out of the project's own repo, once.
    useEffect(() => {
        if (!activeProject || !gitOk) return;
        if (session.gitignorePrompted.includes(activeProject.id)) return;
        needsGitignoreEntry(activeProject.dir).then((needs) => {
            if (needs) setGitignoreAsk(activeProject.id);
        });
    }, [activeProject, gitOk, session.gitignorePrompted]);

    const resolveGitignore = (add: boolean) => {
        const id = gitignoreAsk;
        setGitignoreAsk(null);
        if (!id) return;
        const project = session.projects.find((p) => p.id === id);
        setSession((s) => ({
            ...s,
            gitignorePrompted: [...s.gitignorePrompted, id],
        }));
        if (add && project) {
            addGitignoreEntry(project.dir).catch((err) =>
                setStatus(`Could not update .gitignore: ${err}`),
            );
        }
    };

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
        const t = window.setTimeout(() => setStatus(null), 3000);
        return () => window.clearTimeout(t);
    }, [status]);

    // ---- render --------------------------------------------------------------

    /** Shared by both side panels, standing in for their panel title. */
    const sideTabs = (
        <div className="side-tabs" role="tablist" aria-label="Side panel">
            {(["files", "search"] as const).map((id) => (
                <button
                    key={id}
                    role="tab"
                    aria-selected={session.sidePanel === id}
                    className={session.sidePanel === id ? "active" : ""}
                    onClick={() => patch({sidePanel: id})}
                >
                    {id === "files" ? "Files" : "Search"}
                </button>
            ))}
        </div>
    );

    return (
        <div className="app">
            <header className="header">
                {/* Sits in the gap the tabs leave for the sidebar, taken out of
                    flow so it can't shift the alignment they depend on. */}
                <div className="brand" title="Obelisk">
                    <BrandMark/>
                </div>
                <div className="tabs" ref={tabStrip}>
                    {session.openFiles.map((f) => (
                        <div
                            key={f.path}
                            className={`tab${f.path === activePath ? " active" : ""}`}
                            onClick={() => patch({activeFilePath: f.path})}
                        >
                            <span className="tab-name">{basename(f.path)}</span>
                            {f.path === activePath && dirty && <span className="tab-dot"/>}
                            <button
                                className="tab-close"
                                title="Close"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    closeFile(f.path);
                                }}
                            >
                                <X size={12}/>
                            </button>
                        </div>
                    ))}
                </div>
                <div className="header-actions">
                    {/* ponytail: shown whenever anything is open rather than only when
              the strip actually overflows — measuring that costs a resize
              observer and a re-render, and a permanent list is easier to find
              anyway. Gate it on overflow if the button starts feeling noisy. */}
                    {session.openFiles.length > 0 && (
                        <DropdownMenu.Root>
                            <DropdownMenu.Trigger asChild>
                                <button className="icon-btn" title="Open files">
                                    <ChevronDown size={16}/>
                                </button>
                            </DropdownMenu.Trigger>
                            <DropdownMenu.Portal>
                                <DropdownMenu.Content
                                    className="menu file-menu"
                                    align="end"
                                    sideOffset={4}
                                >
                                    {session.openFiles.map((f) => (
                                        <DropdownMenu.Item
                                            key={f.path}
                                            className={`menu-item file${f.path === activePath ? " active" : ""}`}
                                            onSelect={() => patch({activeFilePath: f.path})}
                                        >
                                            <span className="menu-item-name">
                                                {basename(f.path)}
                                            </span>
                                            {/* Two files can share a name, so the folder
                          disambiguates them. */}
                                            <span className="menu-item-dir">
                                                {dirname(f.path)}
                                            </span>
                                        </DropdownMenu.Item>
                                    ))}
                                </DropdownMenu.Content>
                            </DropdownMenu.Portal>
                        </DropdownMenu.Root>
                    )}
                    <button
                        className="btn"
                        title={
                            gitOk
                                ? "Create a checkpoint"
                                : "git was not found on PATH"
                        }
                        disabled={!activePath || !activeProject || !gitOk || ckptBusy}
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
                                <div className="editor-wrap">
                                    {conflict != null && (
                                        <div className="conflict-banner">
                      <span>
                        {basename(activePath ?? "")} changed on disk while you
                        were editing.
                      </span>
                                            <div className="conflict-actions">
                                                <button className="btn" onClick={acceptExternal}>
                                                    Reload
                                                </button>
                                                <button className="btn" onClick={keepMine}>
                                                    Keep mine
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                    {findOpen && (
                                        <FindBar
                                            api={findApi}
                                            showReplace={findReplace}
                                            onShowReplaceChange={setFindReplace}
                                            onClose={closeFind}
                                            readOnly={readOnly}
                                        />
                                    )}
                                    <div
                                        className="editor-scroll-host"
                                        ref={scrollHost}
                                        onScroll={(e) => {
                                            const top = e.currentTarget.scrollTop;
                                            setSession((s) => ({
                                                ...s,
                                                openFiles: s.openFiles.map((f) =>
                                                    f.path === activePath ? {...f, scroll: top} : f,
                                                ),
                                            }));
                                        }}
                                    >
                                        <Editor
                                            path={activePath}
                                            revision={revision}
                                            mode={session.mode}
                                            theme={theme}
                                            zoom={session.editorZoom ?? DEFAULT_ZOOM}
                                            onModeChange={(mode: EditorMode) => patch({mode})}
                                            value={content}
                                            readOnly={readOnly}
                                            cursor={
                                                activeFile?.cursorMode === session.mode
                                                    ? activeFile.cursor
                                                    : undefined
                                            }
                                            onChange={onChange}
                                            onCursorChange={onCursorChange}
                                            onFindApi={setFindApi}
                                        />
                                    </div>
                                </div>
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
                                <div className="terminal-panel">
                                    <div className="term-tabs-bar">
                                        <div className="term-tabs">
                                            {session.terminals.map((t) => (
                                                <div
                                                    key={t.id}
                                                    className={`term-tab${t.id === session.activeTerminalId ? " active" : ""}`}
                                                    onClick={() => patch({activeTerminalId: t.id})}
                                                    title={t.cwd}
                                                >
                                                    <TerminalSquare size={13}/>
                                                    <span>{t.title}</span>
                                                    <button
                                                        className="tab-close"
                                                        title="Close terminal"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            closeTerminal(t.id);
                                                        }}
                                                    >
                                                        <X size={11}/>
                                                    </button>
                                                </div>
                                            ))}
                                            <button
                                                className="icon-btn"
                                                title="New terminal"
                                                onClick={addTerminal}
                                            >
                                                <Plus size={14}/>
                                            </button>
                                        </div>
                                        <button
                                            className="icon-btn"
                                            title={
                                                session.terminalCollapsed
                                                    ? "Show terminal"
                                                    : "Hide terminal"
                                            }
                                            onClick={toggleTerminalPanel}
                                        >
                                            {session.terminalCollapsed ? (
                                                <ChevronUp size={16}/>
                                            ) : (
                                                <ChevronDown size={16}/>
                                            )}
                                        </button>
                                    </div>

                                    <div className="terminal-body">
                                        {session.terminals.length === 0 && (
                                            <div className="panel-empty">
                                                No terminal open — click + to start one.
                                            </div>
                                        )}
                                        {shell &&
                                            session.terminals.map((t) => (
                                                <TerminalView
                                                    key={t.id}
                                                    cwd={t.cwd}
                                                    shell={shell}
                                                    startupCommand={t.startupCommand}
                                                    active={t.id === session.activeTerminalId}
                                                    theme={theme}
                                                    palette={themeDef(editorSettings.theme)[theme]}
                                                    onExit={() => closeTerminal(t.id)}
                                                />
                                            ))}
                                    </div>
                                </div>
                            </Panel>
                        </Group>

                        <footer className="footer">
                            <div className="footer-path" title={activePath ?? ""}>
                                <bdi>{activePath ?? "No file open"}</bdi>
                            </div>
                            <div className="footer-actions">
                                {status && <span className="footer-status">{status}</span>}
                                {readOnly && <span className="footer-badge">read-only</span>}
                                <button
                                    className="icon-btn"
                                    title="Copy file contents"
                                    disabled={!activePath}
                                    onClick={copyContents}
                                >
                                    <Copy size={14}/>
                                </button>
                                <button
                                    className="icon-btn"
                                    title="New file in this folder"
                                    disabled={!activePath}
                                    onClick={() =>
                                        setStatus(
                                            `Use the Files panel — target ${dirname(activePath ?? "")}`,
                                        )
                                    }
                                >
                                    <FilePlus size={14}/>
                                </button>
                            </div>
                        </footer>
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
                    <Group
                        id="side"
                        orientation="vertical"
                        defaultLayout={session.layouts.side}
                        onLayoutChanged={onLayoutChanged("side")}
                    >
                        <Panel
                            panelRef={filesPanel}
                            id="files"
                            defaultSize="60"
                            collapsible
                            collapsedSize={28}
                        >
                            {session.sidePanel === "search" ? (
                                <SearchPanel
                                    root={activeProject?.dir ?? null}
                                    titleSlot={sideTabs}
                                    onOpen={openAtLine}
                                />
                            ) : (
                                <FileBrowser
                                    root={activeProject?.dir ?? null}
                                    activePath={activePath}
                                    collapsed={filesCollapsed}
                                    titleSlot={sideTabs}
                                    onOpen={openFile}
                                    onCollapse={() => {
                                        const p = filesPanel.current;
                                        if (!p) return;
                                        const wasCollapsed = p.isCollapsed();
                                        if (wasCollapsed) p.expand();
                                        else p.collapse();
                                        setFilesCollapsed(!wasCollapsed);
                                    }}
                                />
                            )}
                        </Panel>
                        <Separator className="handle horizontal"/>
                        <Panel id="versions">
                            <VersionsPanel
                                checkpoints={checkpoints}
                                hasFile={!!activePath && !!activeProject}
                                gitMissing={!gitOk}
                                error={ckptError}
                                busy={ckptBusy}
                                onRestore={handleRestore}
                            />
                        </Panel>
                    </Group>
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
                onConfirm={confirmCheckpoint}
                onOpenChange={(open) =>
                    setCkptDialog((d) => ({...d, open}))
                }
            />

            <Dialog.Root
                open={!!gitignoreAsk}
                onOpenChange={(open) => !open && resolveGitignore(false)}
            >
                <Dialog.Portal>
                    <Dialog.Overlay className="overlay"/>
                    <Dialog.Content className="dialog">
                        <Dialog.Title className="dialog-title">
                            Ignore checkpoint history?
                        </Dialog.Title>
                        <p className="dialog-text">
                            This project is a git repository. Obelisk keeps its checkpoint
                            history in <code>.obelisk/git/</code>, which you probably don't
                            want to commit. Add it to this project's <code>.gitignore</code>?
                        </p>
                        <p className="dialog-hint">
                            <code>.obelisk/settings.json</code> stays tracked, so project
                            settings can still be shared.
                        </p>
                        <div className="dialog-actions">
                            <button className="btn" onClick={() => resolveGitignore(false)}>
                                Not now
                            </button>
                            <button
                                className="btn primary"
                                onClick={() => resolveGitignore(true)}
                            >
                                Add it
                            </button>
                        </div>
                    </Dialog.Content>
                </Dialog.Portal>
            </Dialog.Root>
        </div>
    );
}
