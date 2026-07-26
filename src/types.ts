export type Project = {
    id: string;
    name: string;
    color: string;
    dir: string;
};

export type OpenFile = {
    path: string;
    /** Cursor offset, restored on reopen. */
    cursor?: number;
    /**
     * Which view produced `cursor`. ProseMirror positions count node boundaries
     * and CodeMirror offsets don't, so a position from one view is meaningless
     * in the other — only restore when the modes match.
     */
    cursorMode?: EditorMode;
    /** Scroll offset in px, restored on reopen. */
    scroll?: number;
};

export type EditorMode = "wysiwyg" | "source";

export type TerminalTab = {
    id: string;
    title: string;
    /** Respawned here on restart; PTY processes don't survive the app. */
    cwd: string;
    /**
     * Resolved from project settings when the tab is created, not at mount.
     * The terminal spawns as soon as the shell path is known which always
     * beats the async settings read, so reading it later loses the race.
     */
    startupCommand?: string;
};

/** Map of panel id to percentage, as react-resizable-panels reports it. */
export type PanelLayout = Record<string, number>;

export type Session = {
    projects: Project[];
    activeProjectId: string | null;
    openFiles: OpenFile[];
    activeFilePath: string | null;
    leftCollapsed: boolean;
    rightCollapsed: boolean;
    terminalCollapsed: boolean;
    mode: EditorMode;
    terminals: TerminalTab[];
    activeTerminalId: string | null;
    /** Project ids already asked about the .gitignore entry — asked once only. */
    gitignorePrompted: string[];
    layouts: Record<string, PanelLayout>;
};

export const DEFAULT_SESSION: Session = {
    projects: [],
    activeProjectId: null,
    openFiles: [],
    activeFilePath: null,
    leftCollapsed: false,
    rightCollapsed: false,
    terminalCollapsed: true,
    mode: "wysiwyg",
    terminals: [],
    activeTerminalId: null,
    gitignorePrompted: [],
    layouts: {
        outer: {left: 18, center: 56, right: 26},
        center: {editor: 70, terminal: 30},
        side: {files: 60, versions: 40},
    },
};

export type FileNode = {
    name: string;
    path: string;
    isDir: boolean;
    children?: FileNode[];
};
