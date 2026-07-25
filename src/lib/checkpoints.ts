import { invoke } from "@tauri-apps/api/core";

export type Checkpoint = {
  sha: string;
  short: string;
  title: string;
  /** Seconds since the epoch, as git reports it. */
  timestamp: number;
};

export type CheckpointStatus = {
  changed: boolean;
  tracked: boolean;
  diff: string;
};

export const gitAvailable = () => invoke<boolean>("git_available");

export const checkpointStatus = (project: string, file: string) =>
  invoke<CheckpointStatus>("checkpoint_status", { project, file });

/** Commits the file as it exists on disk. Resolves to null if unchanged. */
export const createCheckpoint = (
  project: string,
  file: string,
  message: string,
) => invoke<string | null>("checkpoint_create", { project, file, message });

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
  invoke<Checkpoint[]>("checkpoint_list", { project, file });

export const restoreCheckpoint = (
  project: string,
  file: string,
  sha: string,
) => invoke<void>("checkpoint_restore", { project, file, sha });
