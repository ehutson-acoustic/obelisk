import {Check} from "lucide-react";
import {useEffect, useState} from "react";
import {
    type DefaultEditorState,
    defaultEditorState,
    setDefaultEditor,
} from "../lib/associations";

/**
 * Claims the system's Markdown binding (DESIGN §10.2).
 *
 * Reads its own state rather than taking it as a prop, because the answer lives
 * in the OS and moves behind the app's back — another editor installing itself,
 * or the user picking one in Finder. Mounting is the moment it is worth knowing,
 * and the dialog mounts this only while the tab is shown.
 */
export function DefaultEditorSetting() {
    const [state, setState] = useState<DefaultEditorState | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        defaultEditorState()
            .then(setState)
            .catch((err) => setError(String(err)));
    }, []);

    const claim = async () => {
        setBusy(true);
        setError(null);
        try {
            setState(await setDefaultEditor());
        } catch (err) {
            setError(String(err));
        } finally {
            setBusy(false);
        }
    };

    // The blocked reason names what is missing — an uninstalled bundle, an absent
    // desktop entry — so it wins over a generic failure when both exist.
    const problem = state?.blocked ?? error;

    return (
        <div className="field">
            <span>Default Markdown editor</span>

            {state?.default ? (
                <p className="default-editor-ok">
                    <Check size={14}/>
                    <span>
                        Obelisk opens <code>.md</code> and <code>.markdown</code> files.
                    </span>
                </p>
            ) : (
                <>
                    <div className="field-row">
                        <button
                            className="btn"
                            disabled={busy || !state?.supported || !!state?.blocked}
                            title={state?.blocked ?? undefined}
                            onClick={claim}
                        >
                            {busy ? "Setting…" : "Make Obelisk the default"}
                        </button>
                    </div>
                    {state?.current && (
                        <p className="dialog-hint">
                            Currently opens in <code>{state.current}</code>.
                        </p>
                    )}
                </>
            )}

            {problem && <p className="dialog-warn">{problem}</p>}

            <p className="dialog-hint">
                <code>.mdx</code> has no registered system type, so it can only be
                assigned per file.
            </p>
        </div>
    );
}
