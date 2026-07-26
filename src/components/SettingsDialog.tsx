import * as Dialog from "@radix-ui/react-dialog";
import {Monitor, Moon, Sun} from "lucide-react";
import {useState} from "react";
import type {Appearance, AppSettings} from "../lib/appSettings";
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
    const [tab, setTab] = useState<"appearance" | "markdown">("appearance");

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
                    </div>

                    {tab === "appearance" ? (
                        <div className="field">
                            <span>Theme</span>
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
                    ) : (
                        <>
                            <ThemeEditor
                                settings={settings.editor}
                                onChange={(editor) => onChange({...settings, editor})}
                            />
                            <p className="dialog-hint">
                                These are the defaults. Any project can override them from its
                                own settings.
                            </p>
                        </>
                    )}

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
