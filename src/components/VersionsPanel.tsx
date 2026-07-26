import {History, RotateCcw} from "lucide-react";
import type {Checkpoint} from "../lib/checkpoints";
import {formatRelative} from "../lib/relativeTime";

type Props = {
    checkpoints: Checkpoint[];
    hasFile: boolean;
    gitMissing: boolean;
    error: string | null;
    busy: boolean;
    onRestore: (checkpoint: Checkpoint) => void;
};

export function VersionsPanel({
                                  checkpoints,
                                  hasFile,
                                  gitMissing,
                                  error,
                                  busy,
                                  onRestore,
                              }: Readonly<Props>) {
    return (
        <div className="panel">
            <div className="panel-header">
                <span className="panel-title">Versions</span>
                {busy && <span className="panel-note">working…</span>}
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
                {!gitMissing && hasFile && checkpoints.length === 0 && !error && (
                    <div className="panel-empty">
                        No checkpoints yet. Use the Checkpoint button to save one.
                    </div>
                )}
                {checkpoints.map((checkpoint) => (
                    <button
                        key={checkpoint.sha}
                        className="version-row"
                        onClick={() => onRestore(checkpoint)}
                        disabled={busy}
                        title={`Restore this version (${checkpoint.short})`}
                    >
                        <span className="version-title">{checkpoint.title}</span>
                        <span className="version-meta">
              <History size={11}/>
                            {formatRelative(checkpoint.timestamp)}
                            <code>{checkpoint.short}</code>
            </span>
                        <RotateCcw className="version-restore" size={13}/>
                    </button>
                ))}
            </div>
        </div>
    );
}
