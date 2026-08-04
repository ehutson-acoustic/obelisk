import * as Dialog from "@radix-ui/react-dialog";
import {Monitor, Moon, Sun} from "lucide-react";
import {useState} from "react";
import type {Appearance, AppSettings} from "../lib/appSettings";
import {THEMES} from "../lib/editorSettings";
import {resolveTheme} from "../lib/theme";
import {DefaultEditorSetting} from "./DefaultEditorSetting";
import {ThemeEditor} from "./ThemeEditor";

const MODES: { value: Appearance; label: string; icon: typeof Sun }[] = [
    {value: "light", label: "Light", icon: Sun},
    {value: "dark", label: "Dark", icon: Moon},
    {value: "system", label: "System", icon: Monitor},
];

type Props = {
    open: boolean;
    settings: AppSettings;
    onChange: (settings: AppSettings) => void;
    onOpenChange: (open: boolean) => void;
};

export function SettingsDialog({
                                   open,
                                   settings,
                                   onChange,
                                   onOpenChange,
                               }: Readonly<Props>) {
    const [tab, setTab] = useState<"appearance" | "markdown" | "system">(
        "appearance",
    );
    const resolved = resolveTheme(settings.appearance);

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="overlay"/>
                <Dialog.Content className="dialog wide">
                    <Dialog.Title className="dialog-title">Settings</Dialog.Title>

                    <div className="tab-row" role="tablist">
                        <button
                            role="tab"
                            aria-selected={tab === "appearance"}
                            className={tab === "appearance" ? "active" : ""}
                            onClick={() => setTab("appearance")}
                        >
                            Appearance
                        </button>
                        <button
                            role="tab"
                            aria-selected={tab === "markdown"}
                            className={tab === "markdown" ? "active" : ""}
                            onClick={() => setTab("markdown")}
                        >
                            Markdown styling
                        </button>
                        <button
                            role="tab"
                            aria-selected={tab === "system"}
                            className={tab === "system" ? "active" : ""}
                            onClick={() => setTab("system")}
                        >
                            System
                        </button>
                    </div>

                    {tab === "appearance" && (
                        <>
                            {/* Independent of the theme: every theme defines both a
                                light and a dark palette (DESIGN §5.3). */}
                            <div className="field">
                                <span>Mode</span>
                                <div className="mode-row">
                                    {MODES.map(({value, label, icon: Icon}) => (
                                        <button
                                            key={value}
                                            className={`mode-btn${settings.appearance === value ? " active" : ""}`}
                                            aria-pressed={settings.appearance === value}
                                            onClick={() => onChange({...settings, appearance: value})}
                                        >
                                            <Icon size={18}/>
                                            <span>{label}</span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div className="field">
                                <span>Theme</span>
                                <div className="theme-cards">
                                    {Object.entries(THEMES).map(([id, theme]) => (
                                        <button
                                            key={id}
                                            className={`theme-card${settings.editor.theme === id ? " active" : ""}`}
                                            aria-pressed={settings.editor.theme === id}
                                            onClick={() =>
                                                onChange({
                                                    ...settings,
                                                    editor: {...settings.editor, theme: id},
                                                })
                                            }
                                        >
                                            {/* Shows the mode that is actually in use, so the
                                                swatch matches what selecting it will do. */}
                                            <span
                                                className="theme-swatch"
                                                style={{
                                                    background: theme[resolved].bg,
                                                    borderColor: theme[resolved].borderStrong,
                                                }}
                                            >
                                                <span style={{background: theme[resolved].fg}}/>
                                                <span style={{background: theme[resolved].fgMuted}}/>
                                                <span style={{background: theme[resolved].accent}}/>
                                            </span>
                                            <span className="theme-card-text">
                                                <strong>{theme.label}</strong>
                                                <small>{theme.description}</small>
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}

                    {tab === "markdown" && (
                        <ThemeEditor
                            settings={settings.editor}
                            onChange={(editor) => onChange({...settings, editor})}
                        />
                    )}

                    {/* Mounted only while the tab is open, which is what makes the
                        row's OS read happen at a moment its answer is current. */}
                    {tab === "system" && <DefaultEditorSetting/>}

                    <div className="dialog-actions">
                        <button className="btn primary" onClick={() => onOpenChange(false)}>
                            Done
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
