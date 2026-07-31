import {useEffect, useState} from "react";
import {gitAvailable} from "../lib/checkpoints";

/**
 * Whether `git` is on PATH.
 *
 * Its own hook rather than part of `useCheckpoints` because the file watcher
 * needs it too, and the watcher lives *below* checkpoints in the dependency
 * order — see the note on `onBeforeExternalChange` in `App.tsx`.
 *
 * Optimistic until the check returns, so the UI does not flash its
 * git-is-missing state on every start.
 */
export function useGitAvailable() {
    const [gitOk, setGitOk] = useState(true);

    useEffect(() => {
        gitAvailable()
            .then(setGitOk)
            .catch(() => setGitOk(false));
    }, []);

    return gitOk;
}
