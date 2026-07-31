import type {RefObject} from "react";
import {basename} from "../lib/files";
import type {FindApi} from "../lib/find";
import type {DiagramStyle} from "../lib/mermaid";
import type {Theme} from "../lib/theme";
import type {EditorMode} from "../types";
import {Editor} from "./Editor";
import {FindBar} from "./FindBar";

type Props = {
    path: string | null;
    revision: number;
    mode: EditorMode;
    theme: Theme;
    diagramStyle: DiagramStyle;
    zoom: number;
    value: string;
    readOnly: boolean;
    cursor?: number;
    /** Incoming disk content held back because the buffer is dirty (DESIGN §2.3). */
    conflict: string | null;
    findOpen: boolean;
    findApi: FindApi | null;
    findReplace: boolean;
    /** Owned by App, which restores the file's saved offset once it loads. */
    scrollHostRef: RefObject<HTMLDivElement | null>;
    onModeChange: (mode: EditorMode) => void;
    onChange: (value: string) => void;
    onCursorChange: (pos: number) => void;
    onFindApi: (api: FindApi | null) => void;
    onFindReplaceChange: (value: boolean) => void;
    onFindClose: () => void;
    onScroll: (top: number) => void;
    onAcceptExternal: () => void;
    onKeepMine: () => void;
};

/**
 * The editor and the two things that sit above it. Both the banner and the find
 * bar are in the scroll host's *parent*, so they stay put while the document
 * scrolls under them.
 */
export function EditorPane({
                               path,
                               revision,
                               mode,
                               theme,
                               diagramStyle,
                               zoom,
                               value,
                               readOnly,
                               cursor,
                               conflict,
                               findOpen,
                               findApi,
                               findReplace,
                               scrollHostRef,
                               onModeChange,
                               onChange,
                               onCursorChange,
                               onFindApi,
                               onFindReplaceChange,
                               onFindClose,
                               onScroll,
                               onAcceptExternal,
                               onKeepMine,
                           }: Readonly<Props>) {
    return (
        <div className="editor-wrap">
            {conflict != null && (
                <div className="conflict-banner">
                    <span>
                        {basename(path ?? "")} changed on disk while you were editing.
                    </span>
                    <div className="conflict-actions">
                        <button className="btn" onClick={onAcceptExternal}>
                            Reload
                        </button>
                        <button className="btn" onClick={onKeepMine}>
                            Keep mine
                        </button>
                    </div>
                </div>
            )}
            {findOpen && (
                <FindBar
                    api={findApi}
                    showReplace={findReplace}
                    onShowReplaceChange={onFindReplaceChange}
                    onClose={onFindClose}
                    readOnly={readOnly}
                />
            )}
            <div
                className="editor-scroll-host"
                ref={scrollHostRef}
                onScroll={(e) => onScroll(e.currentTarget.scrollTop)}
            >
                <Editor
                    path={path}
                    revision={revision}
                    mode={mode}
                    theme={theme}
                    diagramStyle={diagramStyle}
                    zoom={zoom}
                    onModeChange={onModeChange}
                    value={value}
                    readOnly={readOnly}
                    cursor={cursor}
                    onChange={onChange}
                    onCursorChange={onCursorChange}
                    onFindApi={onFindApi}
                />
            </div>
        </div>
    );
}
