import {GitCommitVertical, PanelRightClose, PanelRightOpen} from "lucide-react";
import {useCallback, useEffect, useMemo, useState} from "react";
import {Group, Panel, Separator} from "react-resizable-panels";
import {BranchMenu} from "./components/BranchMenu";
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
import {useAppearance} from "./hooks/useAppearance";
import {useBranches} from "./hooks/useBranches";
import {useCheckpoints} from "./hooks/useCheckpoints";
import {useDocument} from "./hooks/useDocument";
import {useFileOpens} from "./hooks/useFileOpens";
import {useFind} from "./hooks/useFind";
import {useGitAvailable} from "./hooks/useGitAvailable";
import {usePanelLayout} from "./hooks/usePanelLayout";
import {useStatus} from "./hooks/useStatus";
import {useTerminals} from "./hooks/useTerminals";
import {useZoom} from "./hooks/useZoom";
import {checkpointFromContent} from "./lib/checkpoints";
import {DEFAULT_ZOOM} from "./lib/editorSettings";
import {basename, dirname, isMarkdown} from "./lib/files";
import {loadSession, saveSession} from "./lib/session";
import {DEFAULT_SESSION, type EditorMode, type Project, type Session,} from "./types";

/** Terminal tab bar height; also the panel's collapsed size, so the bar
 *  (and its expand toggle) stays visible when the panel is closed. */
const TERM_BAR_H = 32;

/**
 * The orchestrator. It owns the session — the one object the whole app is a view
 * of — and nothing else: every other concern is a hook in `src/hooks`, and every
 * piece of the render tree is a component in `src/components`.
 *
 * The hooks are called in dependency order, and that order is load-bearing:
 * `useDocument` needs the panel refs and the resolved settings, and both
 * `useCheckpoints` and `useBranches` need the document's buffer and its save
 * path. Effects run in the order their hooks appear here.
 */
export default function App() {
    const [session, setSession] = useState<Session>(DEFAULT_SESSION);
    const [ready, setReady] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [projectSettingsFor, setProjectSettingsFor] = useState<Project | null>(
        null,
    );

    const patch = useCallback(
        (p: Partial<Session>) => setSession((s) => ({...s, ...p})),
        [],
    );

    const activePath = session.activeFilePath;
    const activeProject = useMemo(
        () => session.projects.find((p) => p.id === session.activeProjectId) ?? null,
        [session.projects, session.activeProjectId],
    );
    const activeFile = session.openFiles.find((f) => f.path === activePath);
    const readOnly = !!activePath && !isMarkdown(activePath);
    const zoom = session.editorZoom ?? DEFAULT_ZOOM;

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

    // ---- hooks ---------------------------------------------------------------

    const {status, setStatus} = useStatus();
    const gitOk = useGitAvailable();
    const layout = usePanelLayout({session, setSession, patch, ready});
    const appearance = useAppearance(activeProject, zoom);
    const find = useFind(setSession, layout.rightPanel);
    const term = useTerminals({
        activeProject,
        startupCommand: appearance.editorSettings.terminalStartupCommand,
        terminalCount: session.terminals.length,
        setSession,
        patch,
        termPanel: layout.termPanel,
        setStatus,
    });

    useZoom(setSession, setStatus);

    /**
     * Handed to the watcher so an incoming write cannot take the buffer with it
     * (DESIGN §3.4). It lives here rather than in `useCheckpoints` because the
     * watcher is *below* checkpoints in the hook order — checkpointing needs the
     * document, so the document cannot also reach back into checkpointing.
     */
    const onBeforeExternalChange = useCallback(
        async (text: string) => {
            if (!activeProject || !activePath || !gitOk) return;
            await checkpointFromContent(
                activeProject.dir,
                activePath,
                text,
                `Before external change to ${basename(activePath)}`,
            ).catch(() => {
            });
        },
        [activeProject, activePath, gitOk],
    );

    const doc = useDocument({
        ready,
        activePath,
        readOnly,
        openFiles: session.openFiles,
        setSession,
        patch,
        setStatus,
        onBeforeExternalChange,
    });

    const ckpt = useCheckpoints({
        activeProject,
        activePath,
        gitOk,
        revision: doc.revision,
        intervalMinutes: appearance.editorSettings.checkpointIntervalMinutes,
        doc,
        setStatus,
    });

    const branch = useBranches({
        activeProject,
        activePath,
        gitOk,
        openFiles: session.openFiles,
        setSession,
        doc,
        refreshCheckpoints: ckpt.refreshCheckpoints,
        setStatus,
    });

    // Last, because nothing else depends on it and its own commit has to land on
    // a session the hooks above have already settled.
    useFileOpens({ready, projects: session.projects, setSession, setStatus});

    // ---- render --------------------------------------------------------------

    return (
        <div className="app">
            <header className="header">
                <FileTabs
                    files={session.openFiles}
                    activePath={activePath}
                    dirty={doc.dirty}
                    stripRef={doc.tabStripRef}
                    onSelect={doc.selectFile}
                    onClose={doc.closeFile}
                />
                <div className="header-actions">
                    <OpenFilesMenu
                        files={session.openFiles}
                        activePath={activePath}
                        onSelect={doc.selectFile}
                    />
                    <BranchMenu
                        state={ckpt.repo}
                        branches={branch.branches}
                        busy={ckpt.ckptBusy}
                        disabled={!activeProject || !gitOk || !ckpt.repo?.repo}
                        onOpen={branch.refreshBranches}
                        onSwitch={branch.switchTo}
                        onCreate={branch.createAndSwitch}
                        onStash={branch.stashFor}
                    />
                    <button
                        className="btn"
                        title={ckpt.checkpointBlockedReason ?? "Create a checkpoint"}
                        disabled={
                            !activePath ||
                            !activeProject ||
                            ckpt.ckptBusy ||
                            !!ckpt.checkpointBlockedReason
                        }
                        onClick={ckpt.openCheckpointDialog}
                    >
                        <GitCommitVertical size={14}/> Checkpoint
                    </button>
                    <button
                        className="icon-btn"
                        onClick={() => layout.toggle("rightCollapsed")}
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
                onLayoutChange={layout.syncLeftWidth}
                onLayoutChanged={layout.onLayoutChanged("outer")}
            >
                <Panel
                    panelRef={layout.leftPanel}
                    id="left"
                    defaultSize="18"
                    minSize={170}
                    collapsible
                    collapsedSize={56}
                >
                    <ProjectSidebar
                        hostRef={layout.sidebarEl}
                        projects={session.projects}
                        activeId={session.activeProjectId}
                        collapsed={session.leftCollapsed}
                        onSelect={(id) => patch({activeProjectId: id})}
                        onChange={(projects: Project[]) => patch({projects})}
                        onToggleCollapse={() => layout.toggle("leftCollapsed")}
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
                            onLayoutChanged={layout.onLayoutChanged("center")}
                        >
                            <Panel id="editor">
                                <EditorPane
                                    path={activePath}
                                    revision={doc.revision}
                                    mode={session.mode}
                                    theme={appearance.theme}
                                    diagramStyle={appearance.diagramStyle}
                                    zoom={zoom}
                                    value={doc.content}
                                    readOnly={readOnly}
                                    cursor={
                                        activeFile?.cursorMode === session.mode
                                            ? activeFile.cursor
                                            : undefined
                                    }
                                    conflict={doc.conflict}
                                    findOpen={find.findOpen}
                                    findApi={find.findApi}
                                    findReplace={find.findReplace}
                                    scrollHostRef={doc.scrollHostRef}
                                    onModeChange={(mode: EditorMode) => patch({mode})}
                                    onChange={doc.onChange}
                                    onCursorChange={doc.onCursorChange}
                                    onFindApi={find.setFindApi}
                                    onFindReplaceChange={find.setFindReplace}
                                    onFindClose={find.closeFind}
                                    onScroll={doc.onEditorScroll}
                                    onAcceptExternal={doc.acceptExternal}
                                    onKeepMine={doc.keepMine}
                                />
                            </Panel>

                            {/* Thin grip so only the top edge drags — the tab bar below it
                  needs to stay clickable. */}
                            <Separator className="handle terminal-grip" disableDoubleClick/>

                            <Panel
                                panelRef={layout.termPanel}
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
                                    shell={term.shell}
                                    theme={appearance.theme}
                                    palette={appearance.palette}
                                    onSelect={(id) => patch({activeTerminalId: id})}
                                    onClose={term.closeTerminal}
                                    onAdd={term.addTerminal}
                                    onToggleCollapse={term.toggleTerminalPanel}
                                />
                            </Panel>
                        </Group>

                        <StatusBar
                            path={activePath}
                            status={status}
                            readOnly={readOnly}
                            onCopy={doc.copyContents}
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
                    panelRef={layout.rightPanel}
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
                        filesCollapsed={layout.filesCollapsed}
                        filesPanelRef={layout.filesPanel}
                        defaultLayout={session.layouts.side}
                        onLayoutChanged={layout.onLayoutChanged("side")}
                        onOpen={doc.openFile}
                        onOpenAtLine={doc.openAtLine}
                        onToggleFiles={layout.toggleFilesPanel}
                        versions={{
                            checkpoints: ckpt.checkpoints,
                            hasFile: !!activePath && !!activeProject,
                            gitMissing: !gitOk,
                            noRepo: !!activeProject && gitOk && ckpt.repo?.repo === false,
                            error: ckpt.ckptError,
                            busy: ckpt.ckptBusy,
                            checkpointsOnly: session.versionsCheckpointsOnly,
                            onCheckpointsOnlyChange: (value) =>
                                patch({versionsCheckpointsOnly: value}),
                            onRestore: ckpt.handleRestore,
                        }}
                    />
                </Panel>
            </Group>

            <SettingsDialog
                open={settingsOpen}
                settings={appearance.appSettings}
                onChange={appearance.updateSettings}
                onOpenChange={setSettingsOpen}
            />

            <ProjectSettingsDialog
                project={projectSettingsFor}
                appEditor={appearance.appSettings.editor}
                onClose={() => setProjectSettingsFor(null)}
                onSaved={(overrides) => {
                    if (projectSettingsFor?.id === activeProject?.id) {
                        appearance.setProjectOverrides(overrides);
                    }
                    setStatus("Project settings saved");
                }}
            />

            <CheckpointDialog
                open={ckpt.ckptDialog.open}
                suggestion={ckpt.ckptDialog.suggestion}
                fileName={activePath ?? ""}
                branch={ckpt.repo?.branch ?? null}
                staged={!!ckpt.fileStatus?.staged}
                onConfirm={ckpt.confirmCheckpoint}
                onOpenChange={(open) =>
                    ckpt.setCkptDialog((d) => ({...d, open}))
                }
            />

        </div>
    );
}
