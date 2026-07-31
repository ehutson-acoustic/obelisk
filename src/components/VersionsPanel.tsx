import {GitCommitVertical, History, RotateCcw, User} from "lucide-react";
import type {Checkpoint} from "../lib/checkpoints";
import {formatRelative} from "../lib/relativeTime";

/** Exported so `SidePanel` can forward these without restating every field. */
export type VersionsPanelProps = {
    checkpoints: Checkpoint[];
    hasFile: boolean;
    gitMissing: boolean;
    /** No repo yet, so there is nothing to list and no way to checkpoint. */
    noRepo: boolean;
    error: string | null;
    busy: boolean;
    checkpointsOnly: boolean;
    onCheckpointsOnlyChange: (value: boolean) => void;
    onRestore: (checkpoint: Checkpoint) => void;
};

/**
 * DESIGN §3.5 — the file's whole history, not just the editor's commits, since
 * checkpoints live in the project's own repo now. The filter exists because a
 * long-lived file in a real repo has far more commits than the shadow repo ever
 * held.
 */
export function VersionsPanel({
                                  checkpoints,
                                  hasFile,
                                  gitMissing,
                                  noRepo,
                                  error,
                                  busy,
                                  checkpointsOnly,
                                  onCheckpointsOnlyChange,
                                  onRestore,
                              }: Readonly<VersionsPanelProps>) {
    const shown = checkpointsOnly
        ? checkpoints.filter((c) => c.checkpoint)
        : checkpoints;
    const hidden = checkpoints.length - shown.length;

    return (
        <div className="panel">
            <div className="panel-header">
                <span className="panel-title">Versions</span>
                {busy && <span className="panel-note">working…</span>}
                {hasFile && !gitMissing && checkpoints.length > 0 && (
                    <label className="panel-toggle" title="Hide commits Obelisk did not make">
                        <input type="checkbox" checked={checkpointsOnly}
                               onChange={(e) => onCheckpointsOnlyChange(e.target.checked)}
                        />Checkpoints only
                    </label>
                )}
            </div>
            <div className="panel-body">
                {gitMissing && (
                    <div className="panel-error">
                        git was not found on PATH, so checkpoints are unavailable.
                    </div>
                )}
                {error && <div className="panel-error">{error}</div>}
                {!gitMissing && !hasFile && (
                    <div className="panel-empty">No file open</div>
                )}
                {!gitMissing && hasFile && noRepo && (
                    <div className="panel-empty">
                        This project is not a git repository yet. The first checkpoint
                        creates one.
                    </div>
                )}
                {!gitMissing && hasFile && !noRepo && checkpoints.length === 0 && !error && (
                    <div className="panel-empty">
                        No history for this file yet. Use the Checkpoint button to save a
                        version.
                    </div>
                )}
                {!gitMissing && hasFile && shown.length === 0 && checkpoints.length > 0 && (
                    <div className="panel-empty">
                        No Obelisk checkpoints for this file — {hidden} other{" "}
                        {hidden === 1 ? "commit" : "commits"} hidden by the filter.
                    </div>
                )}
                {shown.map((checkpoint) => (
                    <button
                        key={checkpoint.sha}
                        className={`version-row${checkpoint.checkpoint ? " is-checkpoint" : ""}`}
                        onClick={() => onRestore(checkpoint)}
                        disabled={busy}
                        title={`Restore this version (${checkpoint.short})`}
                    >
                        <span className="version-title">
                            {/* Marks the editor's own commits; the rest are the user's. */}
                            {checkpoint.checkpoint && (
                                <GitCommitVertical
                                    className="version-mark"
                                    size={12}
                                    aria-label="Obelisk checkpoint"
                                />
                            )}
                            {checkpoint.title}
                        </span>
                        <span className="version-meta">
                            <History size={11}/>
                            {formatRelative(checkpoint.timestamp)}
                            {!checkpoint.checkpoint && checkpoint.author && (
                                <>
                                    <User size={11}/>
                                    {checkpoint.author}
                                </>
                            )}
                            <code>{checkpoint.short}</code>
                        </span>
                        <RotateCcw className="version-restore" size={13}/>
                    </button>
                ))}
            </div>
        </div>
    );
}
