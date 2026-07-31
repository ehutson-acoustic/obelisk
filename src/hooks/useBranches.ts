import {exists} from "@tauri-apps/plugin-fs";
import type {Dispatch, SetStateAction} from "react";
import {useCallback, useEffect, useState} from "react";
import type {BranchTarget} from "../components/BranchMenu";
import {
    type Branches,
    checkpointFromContent,
    createBranch,
    listBranches,
    stashChanges,
    switchBranch,
    trackBranch,
} from "../lib/checkpoints";
import type {OpenFile, Project, Session} from "../types";
import type {DocumentApi} from "./useDocument";
import type {SetStatus} from "./useStatus";

const NO_BRANCHES: Branches = {
    current: null,
    defaultBranch: null,
    local: [],
    remote: [],
};

type Options = {
    activeProject: Project | null;
    activePath: string | null;
    gitOk: boolean;
    openFiles: OpenFile[];
    setSession: Dispatch<SetStateAction<Session>>;
    doc: DocumentApi;
    /** A switch moves HEAD, so the file's history has to be re-read after one. */
    refreshCheckpoints: () => Promise<void>;
    setStatus: SetStatus;
};

/** Branch listing and switching (DESIGN §3.7, §3.8). */
export function useBranches({
                                activeProject,
                                activePath,
                                gitOk,
                                openFiles,
                                setSession,
                                doc,
                                refreshCheckpoints,
                                setStatus,
                            }: Options) {
    const [branches, setBranches] = useState<Branches>(NO_BRANCHES);

    const {contentRef, dirtyRef, saveNow, loadInto} = doc;

    const refreshBranches = useCallback(async () => {
        if (!activeProject || !gitOk) {
            setBranches(NO_BRANCHES);
            return;
        }
        try {
            setBranches(await listBranches(activeProject.dir));
        } catch {
            setBranches(NO_BRANCHES);
        }
    }, [activeProject, gitOk]);

    useEffect(() => {
        refreshBranches();
    }, [refreshBranches]);

    /**
     * Never let a branch operation be the reason writing is lost. Only the active
     * file has an in-memory buffer, so it is the only one that can be dirty.
     */
    const secureActiveBuffer = useCallback(
        async (reason: string) => {
            if (!activeProject || !activePath || !gitOk || !dirtyRef.current) return;
            await saveNow();
            await checkpointFromContent(
                activeProject.dir,
                activePath,
                contentRef.current,
                reason,
            ).catch(() => {
                /* blocked repo states are reported by the switch itself */
            });
        },
        [activeProject, activePath, gitOk, dirtyRef, contentRef, saveNow],
    );

    /**
     * A switch rewrites the working tree, so open tabs may have new content or
     * have stopped existing. Reuses the normal reload path for the former and
     * closes tabs for the latter, but only for files inside this project.
     */
    const afterBranchChange = useCallback(
        async (message: string) => {
            if (!activeProject) return;
            await Promise.all([refreshBranches(), refreshCheckpoints()]);

            const owned = openFiles.filter((f) =>
                f.path.startsWith(activeProject.dir),
            );
            const checked = await Promise.all(
                owned.map(async (f) => ({
                    path: f.path,
                    gone: !(await exists(f.path).catch(() => true)),
                })),
            );
            const gone = new Set(checked.filter((c) => c.gone).map((c) => c.path));

            if (gone.size > 0) {
                setSession((s) => {
                    const remaining = s.openFiles.filter((f) => !gone.has(f.path));
                    return {
                        ...s,
                        openFiles: remaining,
                        activeFilePath:
                            s.activeFilePath && gone.has(s.activeFilePath)
                                ? (remaining[remaining.length - 1]?.path ?? null)
                                : s.activeFilePath,
                    };
                });
            }
            if (activePath && !gone.has(activePath)) await loadInto(activePath);

            const closed =
                gone.size > 0
                    ? ` — closed ${gone.size} file${gone.size === 1 ? "" : "s"} not on this branch`
                    : "";
            setStatus(`${message}${closed}`);
        },
        [
            activeProject,
            activePath,
            openFiles,
            setSession,
            loadInto,
            refreshBranches,
            refreshCheckpoints,
            setStatus,
        ],
    );

    /** Rejects with git's message so the dropdown can offer to stash. */
    const switchTo = useCallback(
        async (target: BranchTarget) => {
            if (!activeProject) return;
            await secureActiveBuffer("Before switching branches");
            if (target.reference) {
                await trackBranch(activeProject.dir, target.reference);
            } else {
                await switchBranch(activeProject.dir, target.name);
            }
            await afterBranchChange(`Switched to ${target.name}`);
        },
        [activeProject, secureActiveBuffer, afterBranchChange],
    );

    const createAndSwitch = useCallback(
        async (name: string) => {
            if (!activeProject) return;
            await secureActiveBuffer("Before creating a branch");
            await createBranch(activeProject.dir, name);
            await afterBranchChange(`Created ${name}`);
        },
        [activeProject, secureActiveBuffer, afterBranchChange],
    );

    const stashFor = useCallback(
        async (label: string) => {
            if (!activeProject) return;
            const stashed = await stashChanges(activeProject.dir, label);
            if (stashed) setStatus("Stashed local changes");
        },
        [activeProject, setStatus],
    );

    return {branches, refreshBranches, switchTo, createAndSwitch, stashFor};
}
