import {RotateCcw} from "lucide-react";
import {useState} from "react";
import {
    COMPONENT_LABELS,
    type ComponentKey,
    COMPONENTS,
    type ComponentStyle,
    CUSTOM_PRESET,
    type EditorSettings,
    forkToCustom,
    PRESETS,
    resolveComponents,
} from "../lib/editorSettings";

const FIELDS: {
    key: keyof ComponentStyle;
    label: string;
    type: "text" | "color";
    placeholder?: string;
}[] = [
    {key: "fontFamily", label: "Font family", type: "text"},
    {key: "fontSize", label: "Size", type: "text", placeholder: "16px"},
    {key: "fontWeight", label: "Weight", type: "text", placeholder: "400"},
    {key: "lineHeight", label: "Line height", type: "text", placeholder: "1.7"},
    {key: "color", label: "Colour", type: "color"},
];

type Props = {
    settings: EditorSettings;
    onChange: (next: EditorSettings) => void;
    /** Components explicitly overridden here; shown as such with a reset. */
    overridden?: Set<ComponentKey>;
    onResetComponent?: (key: ComponentKey) => void;
};

export function ThemeEditor({
                                settings,
                                onChange,
                                overridden,
                                onResetComponent,
                            }: Readonly<Props>) {
    const [selected, setSelected] = useState<ComponentKey>("body");
    const resolved = resolveComponents(settings);
    const style = resolved[selected];

    const setProperty = (property: keyof ComponentStyle, value: string) => {
        // Editing a shipped preset forks it rather than redefining the preset.
        const base = forkToCustom(settings);
        onChange({
            ...base,
            components: {
                ...base.components,
                [selected]: {...base.components[selected], [property]: value},
            },
        });
    };

    return (
        <div className="theme-editor">
            <label className="field">
                <span>Preset</span>
                <select
                    value={settings.preset}
                    onChange={(e) =>
                        onChange({...settings, preset: e.target.value, components: {}})
                    }
                >
                    {Object.entries(PRESETS).map(([id, preset]) => (
                        <option key={id} value={id}>
                            {preset.label}
                        </option>
                    ))}
                    {settings.preset === CUSTOM_PRESET && (
                        <option value={CUSTOM_PRESET}>Custom</option>
                    )}
                </select>
            </label>

            <div className="theme-grid">
                <div className="theme-components">
                    {COMPONENTS.map((key) => (
                        <button
                            key={key}
                            className={`theme-component${key === selected ? " active" : ""}`}
                            onClick={() => setSelected(key)}
                        >
                            <span>{COMPONENT_LABELS[key]}</span>
                            {overridden?.has(key) && <span className="badge">overridden</span>}
                        </button>
                    ))}
                </div>

                <div className="theme-fields">
                    <div className="theme-fields-head">
                        <span>{COMPONENT_LABELS[selected]}</span>
                        {onResetComponent && overridden?.has(selected) && (
                            <button
                                className="icon-btn"
                                title="Reset to the app default"
                                onClick={() => onResetComponent(selected)}
                            >
                                <RotateCcw size={13}/>
                            </button>
                        )}
                    </div>

                    {FIELDS.map((field) => (
                        <label key={field.key} className="field">
                            <span>{field.label}</span>
                            <input
                                type={field.type}
                                value={style[field.key] ?? ""}
                                placeholder={field.placeholder}
                                onChange={(e) => setProperty(field.key, e.target.value)}
                            />
                        </label>
                    ))}

                    <div
                        className="theme-preview"
                        style={{
                            fontFamily: style.fontFamily,
                            fontSize: style.fontSize,
                            fontWeight: style.fontWeight as never,
                            color: style.color,
                            lineHeight: style.lineHeight,
                        }}
                    >
                        The quick brown fox jumps over the lazy dog.
                    </div>
                </div>
            </div>
        </div>
    );
}
