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
  layouts: {
    outer: { left: 18, center: 82 },
    center: { upper: 70, terminal: 30 },
    upper: { editor: 74, right: 26 },
    side: { files: 60, versions: 40 },
  },
};

export type FileNode = {
  name: string;
  path: string;
  isDir: boolean;
  children?: FileNode[];
};
