import {invoke} from "@tauri-apps/api/core";

export type Checkpoint = {
    sha: string;
    short: string;
    title: string;
    /** Seconds since the epoch, as git reports it. */
    timestamp: number;
    author: string;
    /**
     * Made by Obelisk rather than by hand. Checkpoints and the user's own
     * commits share one history now (DESIGN §3.5), so the panel needs this to
     * mark and filter them.
     */
    checkpoint: boolean;
};

export type CheckpointStatus = {
    changed: boolean;
    tracked: boolean;
    diff: string;
    /** Gitignored, so committing it is refused. */
    ignored: boolean;
    /** Staged at content differing from HEAD; a checkpoint supersedes it. */
    staged: boolean;
};

export type RepoState = {
    repo: boolean;
    branch: string | null;
    head: string | null;
    /** Why checkpointing is unavailable; null when it is safe. */
    blocked: string | null;
};

export type RemoteBranch = {
    /** Full remote-tracking ref, e.g. `origin/feature`. */
    reference: string;
    /** Local branch that checking it out would create. */
    name: string;
};

export type Branches = {
    current: string | null;
    defaultBranch: string | null;
    local: string[];
    remote: RemoteBranch[];
};

export const gitAvailable = () => invoke<boolean>("git_available");

export const checkpointStatus = (project: string, file: string) =>
    invoke<CheckpointStatus>("checkpoint_status", {project, file});

/** Commits the file as it exists on disk. Resolves to null if unchanged. */
export const createCheckpoint = (
    project: string,
    file: string,
    message: string,
) => invoke<string | null>("checkpoint_create", {project, file, message});

/** Commits `content` without touching the working tree. */
export const checkpointFromContent = (
    project: string,
    file: string,
    content: string,
    message: string,
) =>
    invoke<string | null>("checkpoint_from_content", {
        project,
        file,
        content,
        message,
    });

export const listCheckpoints = (project: string, file: string) =>
    invoke<Checkpoint[]>("checkpoint_list", {project, file});

/**
 * The file's content at `sha`. Deliberately not written by Rust — the caller
 * writes it through the editor's own save path so `lastWrite` suppresses the
 * watcher echo (DESIGN §3.6).
 */
export const checkpointContent = (project: string, file: string, sha: string) =>
    invoke<string>("checkpoint_content", {project, file, sha});

export const repoState = (project: string) =>
    invoke<RepoState>("repo_state", {project});

/** serde renames nothing, so the one multi-word field arrives snake_cased. */
type RawBranches = Omit<Branches, "defaultBranch"> & {
    default_branch: string | null;
};

export const listBranches = async (project: string): Promise<Branches> => {
    const {default_branch, ...rest} = await invoke<RawBranches>("branch_list", {
        project,
    });
    return {...rest, defaultBranch: default_branch};
};

export const switchBranch = (project: string, name: string) =>
    invoke<void>("branch_switch", {project, name});

export const createBranch = (project: string, name: string) =>
    invoke<void>("branch_create", {project, name});

/** Checks out a remote-tracking branch by creating a local branch for it. */
export const trackBranch = (project: string, reference: string) =>
    invoke<void>("branch_track", {project, reference});

/** Stashes tracked modifications. Resolves false when there was nothing to do. */
export const stashChanges = (project: string, label: string) =>
    invoke<boolean>("git_stash", {project, label});
