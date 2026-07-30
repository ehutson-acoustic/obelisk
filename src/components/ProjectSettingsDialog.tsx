import * as Dialog from "@radix-ui/react-dialog";
import {RotateCcw} from "lucide-react";
import {useEffect, useState} from "react";
import {type EditorSettings, mergeSettings, type ProjectOverrides, sparseOverrides,} from "../lib/editorSettings";
import {loadProjectSettings, saveProjectSettings,} from "../lib/projectSettings";
import type {Project} from "../types";

type Props = {
    project: Project | null;
    /** App-level defaults these settings layer on top of. */
    appEditor: EditorSettings;
    onClose: () => void;
    onSaved: (overrides: ProjectOverrides) => void;
};

/**
 * DESIGN §5.2 — two scalars, and deliberately nothing else. Markdown styling used
 * to be overridable here; it was removed because the app changing appearance as
 * you moved between projects read as a bug rather than a feature. Styling now
 * lives only in app settings.
 */
export function ProjectSettingsDialog({
                                          project,
                                          appEditor,
                                          onClose,
                                          onSaved,
                                      }: Readonly<Props>) {
    const [effective, setEffective] = useState<EditorSettings>(appEditor);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!project) return;
        setError(null);
        loadProjectSettings(project.dir).then((overrides) =>
            setEffective(mergeSettings(appEditor, overrides)),
        );
    }, [project, appEditor]);

    // Recomputed live so the inherited/overridden markers stay honest.
    const overrides = sparseOverrides(appEditor, effective);

    const save = async () => {
        if (!project) return;
        try {
            await saveProjectSettings(project.dir, overrides);
            onSaved(overrides);
            onClose();
        } catch (err) {
            setError(String(err));
        }
    };

    const marker = (isOverridden: boolean, reset: () => void) =>
        isOverridden ? (
            <button
                className="inherit-tag overridden"
                onClick={reset}
                title="Reset to the app default"
            >
                overridden <RotateCcw size={11}/>
            </button>
        ) : (
            <span className="inherit-tag">inherited</span>
        );

    return (
        <Dialog.Root open={!!project} onOpenChange={(o) => !o && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="overlay"/>
                <Dialog.Content className="dialog">
                    <Dialog.Title className="dialog-title">
                        {project?.name} settings
                    </Dialog.Title>
                    <div className="dialog-hint">
                        Saved sparsely to <code>.obelisk/settings.json</code> — only what
                        differs from your app defaults. Appearance and Markdown styling are
                        app-wide.
                    </div>

                    <label className="field">
                        <span className="field-head">
                            Terminal startup command
                            {marker(overrides.terminalStartupCommand !== undefined, () =>
                                setEffective({
                                    ...effective,
                                    terminalStartupCommand: appEditor.terminalStartupCommand,
                                }),
                            )}
                        </span>
                        <input
                            value={effective.terminalStartupCommand}
                            placeholder="e.g. claude — empty means a plain shell"
                            onChange={(e) =>
                                setEffective({
                                    ...effective,
                                    terminalStartupCommand: e.target.value,
                                })
                            }
                        />
                    </label>

                    <label className="field">
                        <span className="field-head">
                            Checkpoint interval (minutes)
                            {marker(overrides.checkpointIntervalMinutes !== undefined, () =>
                                setEffective({
                                    ...effective,
                                    checkpointIntervalMinutes:
                                    appEditor.checkpointIntervalMinutes,
                                }),
                            )}
                        </span>
                        <input
                            type="number"
                            min={1}
                            value={effective.checkpointIntervalMinutes}
                            onChange={(e) =>
                                setEffective({
                                    ...effective,
                                    checkpointIntervalMinutes: Math.max(
                                        1,
                                        Number(e.target.value) || 1,
                                    ),
                                })
                            }
                        />
                    </label>

                    {error && <div className="panel-error">{error}</div>}

                    <div className="dialog-actions">
                        <button className="btn" onClick={onClose}>
                            Cancel
                        </button>
                        <button className="btn primary" onClick={save}>
                            Save
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
