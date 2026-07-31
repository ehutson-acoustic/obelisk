import {ChevronDown, ChevronUp, Plus, TerminalSquare, X} from "lucide-react";
import type {Palette} from "../lib/editorSettings";
import type {Theme} from "../lib/theme";
import type {TerminalTab} from "../types";
import {TerminalView} from "./Terminal";

type Props = {
    tabs: TerminalTab[];
    activeId: string | null;
    collapsed: boolean;
    /** Null until `default_shell` resolves; nothing can spawn before it does. */
    shell: string | null;
    theme: Theme;
    palette: Palette;
    onSelect: (id: string) => void;
    onClose: (id: string) => void;
    onAdd: () => void;
    onToggleCollapse: () => void;
};

/**
 * Every tab stays mounted — hiding rather than unmounting is what keeps
 * scrollback and running processes alive across a tab switch (DESIGN §4).
 */
export function TerminalPanel({
                                  tabs,
                                  activeId,
                                  collapsed,
                                  shell,
                                  theme,
                                  palette,
                                  onSelect,
                                  onClose,
                                  onAdd,
                                  onToggleCollapse,
                              }: Readonly<Props>) {
    return (
        <div className="terminal-panel">
            <div className="term-tabs-bar">
                <div className="term-tabs">
                    {tabs.map((t) => (
                        <div
                            key={t.id}
                            className={`term-tab${t.id === activeId ? " active" : ""}`}
                            onClick={() => onSelect(t.id)}
                            title={t.cwd}
                        >
                            <TerminalSquare size={13}/>
                            <span>{t.title}</span>
                            <button
                                className="tab-close"
                                title="Close terminal"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onClose(t.id);
                                }}
                            >
                                <X size={11}/>
                            </button>
                        </div>
                    ))}
                    <button className="icon-btn" title="New terminal" onClick={onAdd}>
                        <Plus size={14}/>
                    </button>
                </div>
                <button
                    className="icon-btn"
                    title={collapsed ? "Show terminal" : "Hide terminal"}
                    onClick={onToggleCollapse}
                >
                    {collapsed ? <ChevronUp size={16}/> : <ChevronDown size={16}/>}
                </button>
            </div>

            <div className="terminal-body">
                {tabs.length === 0 && (
                    <div className="panel-empty">
                        No terminal open — click + to start one.
                    </div>
                )}
                {shell &&
                    tabs.map((t) => (
                        <TerminalView
                            key={t.id}
                            cwd={t.cwd}
                            shell={shell}
                            startupCommand={t.startupCommand}
                            active={t.id === activeId}
                            theme={theme}
                            palette={palette}
                            onExit={() => onClose(t.id)}
                        />
                    ))}
            </div>
        </div>
    );
}
