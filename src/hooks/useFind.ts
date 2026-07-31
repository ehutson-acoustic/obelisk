import type {Dispatch, RefObject, SetStateAction} from "react";
import {useCallback, useEffect, useState} from "react";
import type {PanelImperativeHandle} from "react-resizable-panels";
import type {FindApi} from "../lib/find";
import type {Session} from "../types";

/**
 * The find bar's own state and the three shortcuts that open it (DESIGN §8).
 * `findApi` is published by whichever editor view is mounted and revoked when it
 * unmounts, which is what carries the query across a mode switch.
 */
export function useFind(
    setSession: Dispatch<SetStateAction<Session>>,
    rightPanel: RefObject<PanelImperativeHandle | null>,
) {
    const [findApi, setFindApi] = useState<FindApi | null>(null);
    const [findOpen, setFindOpen] = useState(false);
    const [findReplace, setFindReplace] = useState(false);

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
        globalThis.addEventListener("keydown", onKey);
        return () => globalThis.removeEventListener("keydown", onKey);
    }, [setSession, rightPanel]);

    return {findApi, setFindApi, findOpen, findReplace, setFindReplace, closeFind};
}
