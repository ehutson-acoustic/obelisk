import type {Dispatch, SetStateAction} from "react";
import {useCallback, useEffect} from "react";
import {DEFAULT_ZOOM, stepZoom} from "../lib/editorSettings";
import type {Session} from "../types";
import type {SetStatus} from "./useStatus";

/**
 * Cmd/Ctrl +, -, 0 (DESIGN §7). Nothing but the shortcuts lives here — the zoom
 * itself is one number on the session, applied as a CSS variable by
 * `useAppearance`.
 */
export function useZoom(
    setSession: Dispatch<SetStateAction<Session>>,
    setStatus: SetStatus,
) {
    const zoomBy = useCallback(
        (direction: number) => {
            setSession((s) => {
                const next =
                    direction === 0
                        ? DEFAULT_ZOOM
                        : stepZoom(s.editorZoom ?? DEFAULT_ZOOM, direction);
                setStatus(`Editor zoom ${Math.round(next * 100)}%`);
                return {...s, editorZoom: next};
            });
        },
        [setSession, setStatus],
    );

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!e.metaKey && !e.ctrlKey) return;
            // `=` is the unshifted key on the `+` cap, which is what Ctrl+= means
            // on every keyboard layout that matters here; `+` covers the shifted
            // form, and `_` the shifted `-`.
            if (e.key === "=" || e.key === "+") {
                e.preventDefault();
                zoomBy(1);
            } else if (e.key === "-" || e.key === "_") {
                e.preventDefault();
                zoomBy(-1);
            } else if (e.key === "0") {
                e.preventDefault();
                zoomBy(0);
            }
        };
        globalThis.addEventListener("keydown", onKey);
        return () => globalThis.removeEventListener("keydown", onKey);
    }, [zoomBy]);
}
