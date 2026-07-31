import type {Dispatch, SetStateAction} from "react";
import {useCallback, useEffect, useRef, useState} from "react";
import {type Layout, usePanelRef} from "react-resizable-panels";
import type {Session, SessionPatch} from "../types";

type CollapseKey = "leftCollapsed" | "rightCollapsed" | "terminalCollapsed";

type Options = {
    session: Session;
    setSession: Dispatch<SetStateAction<Session>>;
    patch: SessionPatch;
    /** Panels only exist once the session has loaded. */
    ready: boolean;
};

/**
 * Every panel handle, plus the two things that have to happen by hand because
 * react-resizable-panels v4 does not report them: the collapse state after a
 * drag, and the sidebar width the header offsets its tabs by.
 */
export function usePanelLayout({session, setSession, patch, ready}: Options) {
    const leftPanel = usePanelRef();
    const rightPanel = usePanelRef();
    const termPanel = usePanelRef();
    const filesPanel = usePanelRef();
    const sidebarEl = useRef<HTMLDivElement>(null);
    const [filesCollapsed, setFilesCollapsed] = useState(false);

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
    }, [setSession, leftPanel, rightPanel, termPanel, filesPanel]);

    const onLayoutChanged = useCallback(
        (groupId: string) => (layout: Layout) => {
            setSession((s) => ({
                ...s,
                layouts: {...s.layouts, [groupId]: layout},
            }));
            syncCollapsed();
            syncLeftWidth();
        },
        [setSession, syncCollapsed, syncLeftWidth],
    );

    const toggle = useCallback(
        (key: CollapseKey) => {
            const ref = {
                leftCollapsed: leftPanel,
                rightCollapsed: rightPanel,
                terminalCollapsed: termPanel,
            }[key];
            const p = ref.current;
            if (!p) return;
            const collapsed = p.isCollapsed();
            if (collapsed) p.expand();
            else p.collapse();
            patch({[key]: !collapsed} as Partial<Session>);
            syncLeftWidth();
        },
        [patch, syncLeftWidth, leftPanel, rightPanel, termPanel],
    );

    /** Unlike the other three, this collapse is view state and is not persisted. */
    const toggleFilesPanel = useCallback(() => {
        const p = filesPanel.current;
        if (!p) return;
        const wasCollapsed = p.isCollapsed();
        if (wasCollapsed) p.expand();
        else p.collapse();
        setFilesCollapsed(!wasCollapsed);
    }, [filesPanel]);

    return {
        leftPanel,
        rightPanel,
        termPanel,
        filesPanel,
        sidebarEl,
        filesCollapsed,
        syncLeftWidth,
        onLayoutChanged,
        toggle,
        toggleFilesPanel,
    };
}
