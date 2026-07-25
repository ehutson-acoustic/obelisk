import { watch } from "@tauri-apps/plugin-fs";
import {
  Copy,
  FilePlus,
  GitCommitVertical,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  TerminalSquare,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Group,
  type Layout,
  Panel,
  type PanelImperativeHandle,
  Separator,
  usePanelRef,
} from "react-resizable-panels";
import type { RefObject } from "react";
import { Editor } from "./components/Editor";
import { FileBrowser } from "./components/FileBrowser";
import { ProjectSidebar } from "./components/ProjectSidebar";
import { basename, dirname, isMarkdown, readFile, writeFile } from "./lib/files";
import { loadSession, saveSession } from "./lib/session";
import {
  DEFAULT_SESSION,
  type EditorMode,
  type Project,
  type Session,
} from "./types";

const AUTOSAVE_MS = 1000;

export default function App() {
  const [session, setSession] = useState<Session>(DEFAULT_SESSION);
  const [ready, setReady] = useState(false);
  const [content, setContent] = useState("");
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const leftPanel = usePanelRef();
  const rightPanel = usePanelRef();
  const termPanel = usePanelRef();
  const filesPanel = usePanelRef();
  const scrollHost = useRef<HTMLDivElement>(null);
  /** Content of our own most recent write, so the watcher can ignore the echo. */
  const lastWrite = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);
  const cursorTimer = useRef<number | null>(null);

  const activePath = session.activeFilePath;
  const activeProject = useMemo(
    () => session.projects.find((p) => p.id === session.activeProjectId) ?? null,
    [session.projects, session.activeProjectId],
  );
  const readOnly = !!activePath && !isMarkdown(activePath);
  const activeFile = session.openFiles.find((f) => f.path === activePath);

  const patch = useCallback(
    (p: Partial<Session>) => setSession((s) => ({ ...s, ...p })),
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

  /** v4 has no per-panel collapse callback, so read the refs after a drag. */
  const syncCollapsed = useCallback(() => {
    setSession((s) => ({
      ...s,
      leftCollapsed: leftPanel.current?.isCollapsed() ?? s.leftCollapsed,
      rightCollapsed: rightPanel.current?.isCollapsed() ?? s.rightCollapsed,
      terminalCollapsed:
        termPanel.current?.isCollapsed() ?? s.terminalCollapsed,
    }));
  }, [leftPanel, rightPanel, termPanel]);

  const onLayoutChanged = useCallback(
    (groupId: string) => (layout: Layout) => {
      setSession((s) => ({
        ...s,
        layouts: { ...s.layouts, [groupId]: layout },
      }));
      syncCollapsed();
    },
    [syncCollapsed],
  );

  const toggle = (
    ref: RefObject<PanelImperativeHandle | null>,
    key: "leftCollapsed" | "rightCollapsed" | "terminalCollapsed",
  ) => {
    const p = ref.current;
    if (!p) return;
    const collapsed = p.isCollapsed();
    if (collapsed) p.expand();
    else p.collapse();
    patch({ [key]: !collapsed } as Partial<Session>);
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
        : [...s.openFiles, { path }],
    }));
  }, []);

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

  const closeFile = (path: string) => {
    setSession((s) => {
      const openFiles = s.openFiles.filter((f) => f.path !== path);
      const next =
        s.activeFilePath === path
          ? (openFiles[openFiles.length - 1]?.path ?? null)
          : s.activeFilePath;
      return { ...s, openFiles, activeFilePath: next };
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
            ? { ...f, cursor: pos, cursorMode: s.mode }
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
            lastWrite.current = text;
            setContent(text);
            setRevision((r) => r + 1);
          }
        } catch {
          /* file may be mid-replace; the next event settles it */
        }
      },
      { delayMs: 150 },
    ).then((fn) => {
      if (cancelled) fn();
      else unwatch = fn;
    });

    return () => {
      cancelled = true;
      unwatch?.();
    };
  }, [activePath, dirty, content]);

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

  return (
    <div className="app">
      <header className="header">
        <div className="tabs">
          {session.openFiles.map((f) => (
            <div
              key={f.path}
              className={`tab${f.path === activePath ? " active" : ""}`}
              onClick={() => patch({ activeFilePath: f.path })}
            >
              <span className="tab-name">{basename(f.path)}</span>
              {f.path === activePath && dirty && <span className="tab-dot" />}
              <button
                className="tab-close"
                title="Close"
                onClick={(e) => {
                  e.stopPropagation();
                  closeFile(f.path);
                }}
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        <div className="header-actions">
          <button className="btn" title="Create a checkpoint (P3)" disabled>
            <GitCommitVertical size={14} /> Checkpoint
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
              <PanelRightOpen size={16} />
            ) : (
              <PanelRightClose size={16} />
            )}
          </button>
        </div>
      </header>

      <Group
        id="outer"
        orientation="horizontal"
        className="main"
        defaultLayout={session.layouts.outer}
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
            projects={session.projects}
            activeId={session.activeProjectId}
            collapsed={session.leftCollapsed}
            onSelect={(id) => patch({ activeProjectId: id })}
            onChange={(projects: Project[]) => patch({ projects })}
            onToggleCollapse={() => toggle(leftPanel, "leftCollapsed")}
            onOpenAppSettings={() =>
              setStatus("Application settings land in P4")
            }
          />
        </Panel>

        <Separator className="handle vertical" />

        <Panel id="center">
          <Group
            id="center"
            orientation="vertical"
            defaultLayout={session.layouts.center}
            onLayoutChanged={onLayoutChanged("center")}
          >
            <Panel id="upper">
              <Group
                id="upper"
                orientation="horizontal"
                defaultLayout={session.layouts.upper}
                onLayoutChanged={onLayoutChanged("upper")}
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
                    <div
                      className="editor-scroll-host"
                      ref={scrollHost}
                      onScroll={(e) => {
                        const top = e.currentTarget.scrollTop;
                        setSession((s) => ({
                          ...s,
                          openFiles: s.openFiles.map((f) =>
                            f.path === activePath ? { ...f, scroll: top } : f,
                          ),
                        }));
                      }}
                    >
                      <Editor
                        path={activePath}
                        revision={revision}
                        mode={session.mode}
                        onModeChange={(mode: EditorMode) => patch({ mode })}
                        value={content}
                        readOnly={readOnly}
                        cursor={activeFile?.cursorMode === session.mode
                          ? activeFile.cursor
                          : undefined}
                        onChange={onChange}
                        onCursorChange={onCursorChange}
                      />
                    </div>
                  </div>
                </Panel>

                <Separator className="handle vertical" />

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
                      <FileBrowser
                        root={activeProject?.dir ?? null}
                        activePath={activePath}
                        onOpen={openFile}
                        onCollapse={() => {
                          const p = filesPanel.current;
                          if (!p) return;
                          if (p.isCollapsed()) p.expand();
                          else p.collapse();
                        }}
                      />
                    </Panel>
                    <Separator className="handle horizontal" />
                    <Panel id="versions">
                      <div className="panel">
                        <div className="panel-header">
                          <span className="panel-title">Versions</span>
                        </div>
                        <div className="panel-body">
                          <div className="panel-empty">
                            Checkpoints arrive in P3.
                          </div>
                        </div>
                      </div>
                    </Panel>
                  </Group>
                </Panel>
              </Group>
            </Panel>

            {/* The terminal tab bar doubles as the separator, so it stays
                visible when the panel is collapsed. */}
            <Separator className="handle terminal-bar" disableDoubleClick>
              <div className="term-tabs">
                <div className="term-tab active">
                  <TerminalSquare size={13} /> Terminal 1
                </div>
                <button
                  className="icon-btn"
                  title="New terminal (P2)"
                  disabled
                  onPointerDown={(e) => e.stopPropagation()}
                >
                  <Plus size={14} />
                </button>
              </div>
              <button
                className="icon-btn"
                title={
                  session.terminalCollapsed ? "Show terminal" : "Hide terminal"
                }
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => toggle(termPanel, "terminalCollapsed")}
              >
                {session.terminalCollapsed ? "▲" : "▼"}
              </button>
            </Separator>

            <Panel
              panelRef={termPanel}
              id="terminal"
              defaultSize="30"
              minSize={80}
              collapsible
              collapsedSize={0}
            >
              <div className="terminal-body">
                <span>Terminal arrives in P2.</span>
              </div>
            </Panel>
          </Group>
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
            <Copy size={14} />
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
            <FilePlus size={14} />
          </button>
        </div>
      </footer>
    </div>
  );
}
