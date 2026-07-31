import {X} from "lucide-react";
import type {RefObject} from "react";
import {basename} from "../lib/files";
import type {OpenFile} from "../types";

type Props = {
    files: OpenFile[];
    activePath: string | null;
    /** Only the active file has an in-memory buffer, so only it can be dirty. */
    dirty: boolean;
    /**
     * Owned by App, which scrolls the active tab back into view when it changes
     * — with many files open the strip scrolls and the tab is otherwise lost.
     */
    stripRef: RefObject<HTMLDivElement | null>;
    onSelect: (path: string) => void;
    onClose: (path: string) => void;
};

export function FileTabs({
                             files,
                             activePath,
                             dirty,
                             stripRef,
                             onSelect,
                             onClose,
                         }: Readonly<Props>) {
    return (
        <div className="tabs" ref={stripRef}>
            {files.map((f) => (
                <div
                    key={f.path}
                    className={`tab${f.path === activePath ? " active" : ""}`}
                    onClick={() => onSelect(f.path)}
                >
                    <span className="tab-name">{basename(f.path)}</span>
                    {f.path === activePath && dirty && <span className="tab-dot"/>}
                    <button
                        className="tab-close"
                        title="Close"
                        onClick={(e) => {
                            e.stopPropagation();
                            onClose(f.path);
                        }}
                    >
                        <X size={12}/>
                    </button>
                </div>
            ))}
        </div>
    );
}
