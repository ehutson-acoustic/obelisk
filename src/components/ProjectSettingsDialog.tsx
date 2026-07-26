import * as Dialog from "@radix-ui/react-dialog";
import {RotateCcw} from "lucide-react";
import {useEffect, useState} from "react";
import {
    type ComponentKey,
    type EditorSettings,
    mergeSettings,
    type ProjectOverrides,
    sparseOverrides,
} from "../lib/editorSettings";
import {loadProjectSettings, saveProjectSettings,} from "../lib/projectSettings";
import type {Project} from "../types";
import {ThemeEditor} from "./ThemeEditor";

type Props = {
    project: Project | null;
    /** App-level defaults these settings layer on top of. */
    appEditor: EditorSettings;
    onClose: () => void;
    onSaved: (overrides: ProjectOverrides) => void;
};

export function ProjectSettingsDialog({
                                          project,
                                          appEditor,
                                          onClose,
                                          onSaved,
                                      }: Readonly<Props>) {
    const [effective, setEffective] = useState<EditorSettings>(appEditor);
    const [tab, setTab] = useState<"general" | "markdown">("general");
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!project) return;
        setTab("general");
        setError(null);
        loadProjectSettings(project.dir).then((overrides) =>
            setEffective(mergeSettings(appEditor, overrides)),
        );
    }, [project, appEditor]);

    // Recomputed live so the inherited/overridden markers stay honest.
    const overrides = sparseOverrides(appEditor, effective);
    const overriddenComponents = new Set(
        Object.keys(overrides.components ?? {}) as ComponentKey[],
    );

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
            <button className="inherit-tag overridden" onClick={reset} title="Reset to the app default">
                overridden <RotateCcw size={11}/>
            </button>
        ) : (
            <span className="inherit-tag">inherited</span>
        );

    return (
        <Dialog.Root open={!!project} onOpenChange={(o) => !o && onClose()}>
            <Dialog.Portal>
                <Dialog.Overlay className="overlay"/>
                <Dialog.Content className="dialog wide">
                    <Dialog.Title className="dialog-title">
                        {project?.name} settings
                    </Dialog.Title>
                    <div className="dialog-hint">
                        Saved sparsely to <code>.mdeditor/settings.json</code> — only what
                        differs from your app defaults.
                    </div>

                    <div className="tab-row" role="tablist">
                        <button
                            role="tab"
                            aria-selected={tab === "general"}
                            className={tab === "general" ? "active" : ""}
                            onClick={() => setTab("general")}
                        >
                            General
                        </button>
                        <button
                            role="tab"
                            aria-selected={tab === "markdown"}
                            className={tab === "markdown" ? "active" : ""}
                            onClick={() => setTab("markdown")}
                        >
                            Markdown styling
                        </button>
                    </div>

                    {tab === "general" ? (
                        <>
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
                    {marker(
                        overrides.checkpointIntervalMinutes !== undefined,
                        () =>
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
                        </>
                    ) : (
                        <ThemeEditor
                            settings={effective}
                            onChange={setEffective}
                            overridden={overriddenComponents}
                            onResetComponent={(key) =>
                                setEffective(
                                    mergeSettings(appEditor, {
                                        ...overrides,
                                        components: Object.fromEntries(
                                            Object.entries(overrides.components ?? {}).filter(
                                                ([k]) => k !== key,
                                            ),
                                        ),
                                    }),
                                )
                            }
                        />
                    )}

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
