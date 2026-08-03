import {invoke} from "@tauri-apps/api/core";
import type {Dispatch, RefObject, SetStateAction} from "react";
import {useCallback, useEffect, useState} from "react";
import type {PanelImperativeHandle} from "react-resizable-panels";
import type {Project, Session, SessionPatch} from "../types";
import type {SetStatus} from "./useStatus";

type Options = {
    activeProject: Project | null;
    /**
     * Resolved when a tab is created and stored on it, never read at mount: the
     * terminal spawns as soon as the shell path is known which always beats the
     * async settings read (DESIGN §4).
     */
    startupCommand: string;
    terminalCount: number;
    setSession: Dispatch<SetStateAction<Session>>;
    patch: SessionPatch;
    termPanel: RefObject<PanelImperativeHandle | null>;
    setStatus: SetStatus;
};

export function useTerminals({
                                 activeProject,
                                 startupCommand,
                                 terminalCount,
                                 setSession,
                                 patch,
                                 termPanel,
                                 setStatus,
                             }: Options) {
    const [shell, setShell] = useState<string | null>(null);

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
        const command = startupCommand.trim();
        setSession((s) => ({
            ...s,
            terminals: [
                ...s.terminals,
                {
                    id,
                    title: `Terminal ${s.terminals.length + 1}`,
                    cwd: activeProject.dir,
                    startupCommand: command || undefined,
                },
            ],
            activeTerminalId: id,
        }));
    }, [activeProject, startupCommand, setSession, setStatus]);

    const closeTerminal = useCallback(
        (id: string) => {
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
        },
        [setSession],
    );

    /** Opening the panel with nothing in it starts a terminal, so it is never empty. */
    const toggleTerminalPanel = useCallback(() => {
        const p = termPanel.current;
        if (!p) return;
        const collapsed = p.isCollapsed();
        if (collapsed) {
            p.expand();
            if (terminalCount === 0) addTerminal();
        } else {
            p.collapse();
        }
        patch({terminalCollapsed: !collapsed});
    }, [termPanel, terminalCount, addTerminal, patch]);

    return {shell, addTerminal, closeTerminal, toggleTerminalPanel};
}
