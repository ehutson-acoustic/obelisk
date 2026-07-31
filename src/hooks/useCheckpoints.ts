import {useCallback, useEffect, useMemo, useState} from "react";
import {
    type Checkpoint,
    checkpointContent,
    checkpointFromContent,
    checkpointStatus,
    type CheckpointStatus,
    createCheckpoint,
    listCheckpoints,
    repoState,
    type RepoState,
} from "../lib/checkpoints";
import {checkpointTitle} from "../lib/checkpointTitle";
import {basename} from "../lib/files";
import type {Project} from "../types";
import type {DocumentApi} from "./useDocument";
import type {SetStatus} from "./useStatus";

type Options = {
    activeProject: Project | null;
    activePath: string | null;
    gitOk: boolean;
    /** Bumped whenever the file is reloaded, which is when history may have moved. */
    revision: number;
    intervalMinutes: number;
    doc: DocumentApi;
    setStatus: SetStatus;
};

/**
 * Per-file history in the project's own repo (DESIGN §3). Everything here is
 * active-file-only, and every write path flushes the buffer first so a commit
 * matches what is on screen.
 */
export function useCheckpoints({
                                   activeProject,
                                   activePath,
                                   gitOk,
                                   revision,
                                   intervalMinutes,
                                   doc,
                                   setStatus,
                               }: Options) {
    const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
    const [ckptBusy, setCkptBusy] = useState(false);
    const [ckptError, setCkptError] = useState<string | null>(null);
    const [ckptDialog, setCkptDialog] = useState({open: false, suggestion: ""});
    /** Repo state and the active file's git status, refreshed together. */
    const [repo, setRepo] = useState<RepoState | null>(null);
    const [fileStatus, setFileStatus] = useState<CheckpointStatus | null>(null);

    const {contentRef, dirtyRef, flushSave, saveNow, loadInto} = doc;

    /**
     * History, the file's git status, and the repo's own state travel together:
     * `blocked` can start being true because of something done in the terminal,
     * so the Checkpoint button has to re-check rather than trust a cached answer.
     */
    const refreshCheckpoints = useCallback(async () => {
        if (!activeProject || !gitOk) {
            setCheckpoints([]);
            setFileStatus(null);
            setRepo(null);
            return;
        }
        try {
            setRepo(await repoState(activeProject.dir));
        } catch {
            setRepo(null);
        }
        if (!activePath) {
            setCheckpoints([]);
            setFileStatus(null);
            return;
        }
        try {
            const [history, status] = await Promise.all([
                listCheckpoints(activeProject.dir, activePath),
                checkpointStatus(activeProject.dir, activePath),
            ]);
            setCheckpoints(history);
            setFileStatus(status);
            setCkptError(null);
        } catch (err) {
            setCkptError(String(err));
        }
    }, [activeProject, activePath, gitOk]);

    useEffect(() => {
        refreshCheckpoints();
    }, [refreshCheckpoints, revision]);

    const suggestTitle = useCallback(async () => {
        if (!activeProject || !activePath) return "Checkpoint";
        const status = await checkpointStatus(activeProject.dir, activePath);
        return checkpointTitle({
            fileName: basename(activePath),
            content: contentRef.current,
            diff: status.diff,
            tracked: status.tracked,
        });
    }, [activeProject, activePath, contentRef]);

    const openCheckpointDialog = useCallback(async () => {
        if (!activeProject || !activePath) return;
        try {
            setCkptDialog({open: true, suggestion: await suggestTitle()});
        } catch (err) {
            setCkptError(String(err));
        }
    }, [activeProject, activePath, suggestTitle]);

    const confirmCheckpoint = useCallback(
        async (title: string) => {
            if (!activeProject || !activePath) return;
            setCkptDialog({open: false, suggestion: ""});
            setCkptBusy(true);
            try {
                // Flush any pending autosave so the commit matches what's on screen.
                await saveNow();
                const short = await createCheckpoint(
                    activeProject.dir,
                    activePath,
                    title,
                );
                setStatus(short ? `Checkpoint ${short}` : "No changes to checkpoint");
                await refreshCheckpoints();
            } catch (err) {
                setCkptError(String(err));
            } finally {
                setCkptBusy(false);
            }
        },
        [activeProject, activePath, saveNow, refreshCheckpoints, setStatus],
    );

    const handleRestore = useCallback(
        async (checkpoint: Checkpoint) => {
            if (!activeProject || !activePath) return;
            setCkptBusy(true);
            try {
                // Preserve what's on screen first, so no restore is ever destructive
                // and history stays linear (DESIGN §3.6).
                await checkpointFromContent(
                    activeProject.dir,
                    activePath,
                    contentRef.current,
                    `Before restoring ${checkpoint.short}`,
                );
                // Written here rather than by `git checkout` so the write goes
                // through `lastWrite` and the watcher ignores its own echo.
                const text = await checkpointContent(
                    activeProject.dir,
                    activePath,
                    checkpoint.sha,
                );
                await flushSave(text, activePath);
                await loadInto(activePath);
                await refreshCheckpoints();
                setStatus(`Restored ${checkpoint.short}`);
            } catch (err) {
                setCkptError(String(err));
            } finally {
                setCkptBusy(false);
            }
        },
        [
            activeProject,
            activePath,
            contentRef,
            flushSave,
            loadInto,
            refreshCheckpoints,
            setStatus,
        ],
    );

    // Periodic checkpoint while dirty.
    useEffect(() => {
        if (!activeProject || !activePath || !gitOk) return;
        const id = globalThis.setInterval(
            async () => {
                if (!dirtyRef.current) return;
                try {
                    const short = await createCheckpoint(
                        activeProject.dir,
                        activePath,
                        await suggestTitle(),
                    );
                    if (short) await refreshCheckpoints();
                } catch {
                    /* transient; the next tick tries again */
                }
            },
            Math.max(1, intervalMinutes) * 60_000,
        );
        return () => globalThis.clearInterval(id);
    }, [
        activeProject,
        activePath,
        gitOk,
        intervalMinutes,
        dirtyRef,
        suggestTitle,
        refreshCheckpoints,
    ]);

    /**
     * Everything that makes checkpointing unavailable, as the reason to show in
     * the button's tooltip. A gitignored file is refused by Rust anyway, so
     * saying why up front beats letting the click fail.
     */
    const checkpointBlockedReason = useMemo(() => {
        if (!gitOk) return "git was not found on PATH";
        if (fileStatus?.ignored) return "This file is excluded by .gitignore";
        // A missing repo is not a blocker: the first checkpoint creates one.
        if (repo?.repo && repo.blocked) return `Unavailable while ${repo.blocked}`;
        return null;
    }, [gitOk, fileStatus?.ignored, repo]);

    return {
        repo,
        checkpoints,
        fileStatus,
        ckptBusy,
        ckptError,
        ckptDialog,
        setCkptDialog,
        openCheckpointDialog,
        confirmCheckpoint,
        handleRestore,
        refreshCheckpoints,
        checkpointBlockedReason,
    };
}
