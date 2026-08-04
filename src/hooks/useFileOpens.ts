import {type Dispatch, type SetStateAction, useCallback, useEffect, useRef} from "react";
import {basename, dirname} from "../lib/files";
import {onOpenRequest, projectDirFor, takeOpenRequests} from "../lib/openRequests";
import {newProject, projectFor} from "../lib/projects";
import type {Project, Session} from "../types";
import type {SetStatus} from "./useStatus";

type Options = {
    ready: boolean;
    projects: Project[];
    setSession: Dispatch<SetStateAction<Session>>;
    setStatus: SetStatus;
};

/**
 * Files handed to us by the OS: a double-click in Finder, `xdg-open`, a second
 * launch on Linux (DESIGN §10.1).
 *
 * The session update is assembled here rather than delegated to
 * `useDocument.openFile` because the project and the file have to change in one
 * commit. Everything downstream reads `activeFilePath` against `activeProject`,
 * so a render where the incoming file is still paired with the outgoing project
 * points checkpoints at the wrong repository.
 */
export function useFileOpens({ready, projects, setSession, setStatus}: Options) {
    /** Read inside async work that must not resubscribe as projects change. */
    const projectsRef = useRef(projects);
    projectsRef.current = projects;

    const open = useCallback(
        async (paths: string[]) => {
            for (const path of paths) {
                const existing = projectFor(path, projectsRef.current);
                // A file from outside every configured project still needs one,
                // or it opens with no history, no terminal and no settings.
                const created = existing
                    ? null
                    : newProject(
                        (await projectDirFor(path).catch(() => null)) ?? dirname(path),
                        projectsRef.current.length,
                    );
                const project = existing ?? created;

                // The state this batch's next path resolves against: React has
                // not re-rendered yet, so the ref is still pre-`created`.
                if (created) projectsRef.current = [...projectsRef.current, created];

                setSession((s) => ({
                    ...s,
                    projects:
                        created && !s.projects.some((p) => p.id === created.id)
                            ? [...s.projects, created]
                            : s.projects,
                    activeProjectId: project?.id ?? s.activeProjectId,
                    openFiles: s.openFiles.some((f) => f.path === path)
                        ? s.openFiles
                        : [...s.openFiles, {path}],
                    activeFilePath: path,
                }));

                setStatus(
                    created
                        ? `Opened ${basename(path)} — added project ${created.name}`
                        : `Opened ${basename(path)}`,
                );
            }
        },
        [setSession, setStatus],
    );

    useEffect(() => {
        // Gated on `ready`: the session load replaces state wholesale, so a file
        // opened before it lands would be dropped on the floor.
        if (!ready) return;

        let cancelled = false;
        let unlisten: (() => void) | undefined;

        void (async () => {
            // Subscribe before draining, not after. The drain is what flips Rust
            // over from queueing to emitting, so a listener attached afterwards
            // has a window in which an open event fires into nothing.
            const stop = await onOpenRequest((paths) => void open(paths));
            if (cancelled) {
                stop();
                return;
            }
            unlisten = stop;

            const pending = await takeOpenRequests().catch(() => [] as string[]);
            if (!cancelled && pending.length) await open(pending);
        })();

        return () => {
            cancelled = true;
            unlisten?.();
        };
    }, [ready, open]);
}
