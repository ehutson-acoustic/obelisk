import {watch} from "@tauri-apps/plugin-fs";
import type {Dispatch, SetStateAction} from "react";
import {useCallback, useEffect, useRef, useState} from "react";
import {basename, readFile, writeFile} from "../lib/files";
import type {OpenFile, Session, SessionPatch} from "../types";
import type {SetStatus} from "./useStatus";

const AUTOSAVE_MS = 1000;

type Options = {
    ready: boolean;
    activePath: string | null;
    readOnly: boolean;
    openFiles: OpenFile[];
    setSession: Dispatch<SetStateAction<Session>>;
    patch: SessionPatch;
    setStatus: SetStatus;
    /**
     * Given the buffer's content just before an incoming write replaces it, so
     * the bytes worth keeping can be committed from memory (DESIGN §3.4).
     *
     * Injected rather than called directly because checkpointing depends on this
     * hook — for `flushSave`, `loadInto` and the content mirror — so the arrow
     * cannot also point the other way.
     */
    onBeforeExternalChange: (content: string) => Promise<void>;
};

export type DocumentApi = ReturnType<typeof useDocument>;

/**
 * The active file's buffer and the save/watch loop around it (DESIGN §2.2, §2.3).
 *
 * Autosave fires a second after typing stops because Claude may read the file
 * off disk at any moment. `lastWrite` holds our own most recent write so the
 * watcher can ignore its own echo — break that and the app reload-loops against
 * itself.
 */
export function useDocument({
                                ready,
                                activePath,
                                readOnly,
                                openFiles,
                                setSession,
                                patch,
                                setStatus,
                                onBeforeExternalChange,
                            }: Options) {
    const [content, setContent] = useState("");
    const [revision, setRevision] = useState(0);
    const [dirty, setDirty] = useState(false);
    const [conflict, setConflict] = useState<string | null>(null);

    const scrollHostRef = useRef<HTMLDivElement>(null);
    const tabStripRef = useRef<HTMLDivElement>(null);
    /** Content of our own most recent write, so the watcher can ignore the echo. */
    const lastWrite = useRef<string | null>(null);
    const saveTimer = useRef<number | null>(null);
    const cursorTimer = useRef<number | null>(null);
    /** Read by timers and async callbacks that must not re-subscribe per keystroke. */
    const dirtyRef = useRef(false);
    const contentRef = useRef("");
    dirtyRef.current = dirty;
    contentRef.current = content;

    // ---- open / load ---------------------------------------------------------

    const loadInto = useCallback(
        async (path: string) => {
            try {
                const text = await readFile(path);
                lastWrite.current = text;
                setContent(text);
                setDirty(false);
                setConflict(null);
                setRevision((r) => r + 1);
            } catch (err) {
                setStatus(`Could not open ${basename(path)}: ${err}`);
            }
        },
        [setStatus],
    );

    const openFile = useCallback(
        (path: string) => {
            setSession((s) => ({
                ...s,
                activeFilePath: path,
                openFiles: s.openFiles.some((f) => f.path === path)
                    ? s.openFiles
                    : [...s.openFiles, {path}],
            }));
        },
        [setSession],
    );

    /**
     * Opens a search hit. This forces **source** mode, because a line number only
     * means something there: ProseMirror positions count node boundaries, so the
     * same offset in WYSIWYG lands somewhere unrelated. Jumping to the right place
     * in the wrong mode is not on offer, and silently not jumping would read as a
     * broken result list (DESIGN §8.2).
     */
    const openAtLine = useCallback(
        async (path: string, line: number) => {
            let cursor = 0;
            try {
                const text = await readFile(path);
                const lines = text.split("\n");
                for (let i = 0; i < Math.min(line - 1, lines.length); i += 1) {
                    cursor += lines[i].length + 1;
                }
            } catch {
                // The file moved since the search ran; open it and let the normal
                // load path report the failure.
            }

            const already = activePath === path;
            setSession((s) => {
                const files = s.openFiles.some((f) => f.path === path)
                    ? s.openFiles
                    : [...s.openFiles, {path}];
                return {
                    ...s,
                    mode: "source",
                    activeFilePath: path,
                    openFiles: files.map((f) =>
                        f.path === path ? {...f, cursor, cursorMode: "source"} : f,
                    ),
                };
            });
            // Switching files reloads on its own, but re-opening the file already on
            // screen changes nothing the load effect watches — so the remount that
            // applies the cursor has to be forced.
            if (already) await loadInto(path);
        },
        [activePath, loadInto, setSession],
    );

    // Load whenever the active file changes, including the startup restore.
    useEffect(() => {
        if (!ready || !activePath) return;
        loadInto(activePath);
    }, [ready, activePath, loadInto]);

    // Restore scroll offset after a file loads.
    useEffect(() => {
        const saved = openFiles.find((f) => f.path === activePath)?.scroll;
        if (scrollHostRef.current) scrollHostRef.current.scrollTop = saved ?? 0;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [revision]);

    // With many files open the strip scrolls; keep the active tab reachable
    // without hunting for it.
    useEffect(() => {
        tabStripRef.current
            ?.querySelector(".tab.active")
            ?.scrollIntoView({block: "nearest", inline: "nearest"});
    }, [activePath]);

    const selectFile = useCallback(
        (path: string) => patch({activeFilePath: path}),
        [patch],
    );

    const closeFile = useCallback(
        (path: string) => {
            setSession((s) => {
                const files = s.openFiles.filter((f) => f.path !== path);
                const next =
                    s.activeFilePath === path
                        ? (files[files.length - 1]?.path ?? null)
                        : s.activeFilePath;
                return {...s, openFiles: files, activeFilePath: next};
            });
        },
        [setSession],
    );

    const onEditorScroll = useCallback(
        (top: number) => {
            setSession((s) => ({
                ...s,
                openFiles: s.openFiles.map((f) =>
                    f.path === s.activeFilePath ? {...f, scroll: top} : f,
                ),
            }));
        },
        [setSession],
    );

    // ---- autosave ------------------------------------------------------------

    const flushSave = useCallback(
        async (text: string, path: string) => {
            try {
                lastWrite.current = text;
                await writeFile(path, text);
                setDirty(false);
            } catch (err) {
                setStatus(`Save failed: ${err}`);
            }
        },
        [setStatus],
    );

    /**
     * Cancels the pending autosave and writes the buffer now, so a commit or a
     * branch switch acts on what is actually on screen.
     */
    const saveNow = useCallback(async () => {
        if (!activePath) return;
        if (saveTimer.current) globalThis.clearTimeout(saveTimer.current);
        await flushSave(contentRef.current, activePath);
    }, [activePath, flushSave]);

    const onChange = (text: string) => {
        setContent(text);
        if (readOnly || !activePath) return;
        setDirty(true);
        if (saveTimer.current) globalThis.clearTimeout(saveTimer.current);
        saveTimer.current = globalThis.setTimeout(
            () => flushSave(text, activePath),
            AUTOSAVE_MS,
        );
    };

    // Debounced so cursor movement doesn't re-render the tree on every keystroke.
    const onCursorChange = useCallback(
        (pos: number) => {
            if (cursorTimer.current) globalThis.clearTimeout(cursorTimer.current);
            cursorTimer.current = globalThis.setTimeout(() => {
                setSession((s) => ({
                    ...s,
                    openFiles: s.openFiles.map((f) =>
                        f.path === s.activeFilePath
                            ? {...f, cursor: pos, cursorMode: s.mode}
                            : f,
                    ),
                }));
            }, 400);
        },
        [setSession],
    );

    // Ctrl/Cmd+S force-saves.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
                e.preventDefault();
                if (activePath && !readOnly) {
                    if (saveTimer.current) globalThis.clearTimeout(saveTimer.current);
                    flushSave(content, activePath);
                }
            }
        };
        globalThis.addEventListener("keydown", onKey);
        return () => globalThis.removeEventListener("keydown", onKey);
    }, [activePath, content, readOnly, flushSave]);

    // ---- external changes ----------------------------------------------------

    useEffect(() => {
        if (!activePath) return;
        let unwatch: (() => void) | undefined;
        let cancelled = false;

        watch(
            activePath,
            async () => {
                try {
                    const text = await readFile(activePath);
                    if (text === lastWrite.current || text === content) return;
                    if (dirty) {
                        setConflict(text);
                    } else {
                        // The incoming bytes are already on disk, so the state worth
                        // keeping exists only in the buffer — commit it from memory
                        // before it's replaced (DESIGN §3.4).
                        if (content) await onBeforeExternalChange(content);
                        lastWrite.current = text;
                        setContent(text);
                        setRevision((r) => r + 1);
                    }
                } catch {
                    /* file may be mid-replace; the next event settles it */
                }
            },
            {delayMs: 150},
        ).then((fn) => {
            if (cancelled) fn();
            else unwatch = fn;
        });

        return () => {
            cancelled = true;
            unwatch?.();
        };
    }, [activePath, dirty, content, onBeforeExternalChange]);

    const acceptExternal = useCallback(() => {
        if (conflict == null) return;
        lastWrite.current = conflict;
        setContent(conflict);
        setRevision((r) => r + 1);
        setDirty(false);
        setConflict(null);
    }, [conflict]);

    const keepMine = useCallback(() => {
        setConflict(null);
        if (activePath) flushSave(content, activePath);
    }, [activePath, content, flushSave]);

    const copyContents = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(contentRef.current);
            setStatus("Copied file contents");
        } catch (err) {
            setStatus(`Copy failed: ${err}`);
        }
    }, [setStatus]);

    return {
        content,
        dirty,
        revision,
        conflict,
        contentRef,
        dirtyRef,
        scrollHostRef,
        tabStripRef,
        loadInto,
        flushSave,
        saveNow,
        openFile,
        openAtLine,
        selectFile,
        closeFile,
        onChange,
        onCursorChange,
        onEditorScroll,
        acceptExternal,
        keepMine,
        copyContents,
    };
}
