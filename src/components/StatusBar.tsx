import {Copy, FilePlus} from "lucide-react";

type Props = {
    path: string | null;
    /** Transient message; App clears it after a few seconds. */
    status: string | null;
    readOnly: boolean;
    onCopy: () => void;
    onNewFile: () => void;
};

export function StatusBar({
                              path,
                              status,
                              readOnly,
                              onCopy,
                              onNewFile,
                          }: Readonly<Props>) {
    return (
        <footer className="footer">
            <div className="footer-path" title={path ?? ""}>
                <bdi>{path ?? "No file open"}</bdi>
            </div>
            <div className="footer-actions">
                {status && <span className="footer-status">{status}</span>}
                {readOnly && <span className="footer-badge">read-only</span>}
                <button
                    className="icon-btn"
                    title="Copy file contents"
                    disabled={!path}
                    onClick={onCopy}
                >
                    <Copy size={14}/>
                </button>
                <button
                    className="icon-btn"
                    title="New file in this folder"
                    disabled={!path}
                    onClick={onNewFile}
                >
                    <FilePlus size={14}/>
                </button>
            </div>
        </footer>
    );
}
