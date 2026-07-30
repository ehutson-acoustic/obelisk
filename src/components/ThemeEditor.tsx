import {RotateCcw} from "lucide-react";
import {useEffect, useState} from "react";
import {
    COMPONENT_LABELS,
    type ComponentKey,
    COMPONENTS,
    type ComponentStyle,
    DEFAULT_FAMILIES,
    type EditorSettings,
    resolveComponents,
    themeDef,
} from "../lib/editorSettings";
import {familyLabel, systemFonts} from "../lib/fonts";

const FIELDS: {
    key: keyof ComponentStyle;
    label: string;
    type: "text" | "color";
    placeholder?: string;
}[] = [
    {key: "fontFamily", label: "Font", type: "text"},
    {key: "fontSize", label: "Size", type: "text", placeholder: "16px"},
    {key: "fontWeight", label: "Weight", type: "text", placeholder: "400"},
    {key: "lineHeight", label: "Line height", type: "text", placeholder: "1.7"},
    {key: "color", label: "Color", type: "color"},
    {key: "backgroundColor", label: "Background", type: "color"},
];

/**
 * `<input type="color">` only accepts `#rrggbb`, so the themed defaults — which
 * are `var(--fg)` and friends — show as black unless they're resolved first.
 *
 * `fallbackVar` is what an absent or transparent value should *look* like:
 * backgrounds are usually unset, and showing black for "no background" reads as
 * a real, very wrong choice.
 */
function toHex(value: string | undefined, fallbackVar = ""): string {
    const raw = value?.trim();
    const resolveVar = (name: string) =>
        getComputedStyle(document.documentElement)
            .getPropertyValue(name)
            .trim();

    if (!raw || raw === "transparent" || raw === "none") {
        const fallback = fallbackVar ? resolveVar(fallbackVar) : "";
        return /^#[0-9a-f]{6}$/i.test(fallback) ? fallback : "#000000";
    }
    const resolved = raw.startsWith("var(")
        ? resolveVar(raw.slice(4, -1).trim())
        : raw;
    return /^#[0-9a-f]{6}$/i.test(resolved) ? resolved : "#000000";
}

/** A background is meaningfully absent in a way a colour input cannot express. */
function isTransparent(value: string | undefined): boolean {
    const raw = value?.trim();
    return !raw || raw === "transparent" || raw === "none";
}

function FontSelect({
                        value,
                        fonts,
                        onChange,
                    }: Readonly<{
    value: string;
    fonts: string[];
    onChange: (value: string) => void;
}>) {
    const known =
        DEFAULT_FAMILIES.some((f) => f.value === value) || fonts.includes(value);

    return (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
            {/* A preset or a project may carry a stack that isn't one of ours and
          isn't installed; without this it would silently switch on open. */}
            {!known && <option value={value}>{familyLabel(value)}</option>}
            <optgroup label="Theme defaults">
                {DEFAULT_FAMILIES.map((family) => (
                    <option key={family.value} value={family.value}>
                        {family.label}
                    </option>
                ))}
            </optgroup>
            <optgroup label="Installed">
                {fonts.map((font) => (
                    <option key={font} value={font}>
                        {font}
                    </option>
                ))}
            </optgroup>
        </select>
    );
}

type Props = {
    settings: EditorSettings;
    onChange: (next: EditorSettings) => void;
};

/**
 * Per-component Markdown styling, layered over whatever theme is active. Edits
 * here are stored as overrides rather than forking the theme, so switching themes
 * keeps them and resetting a component returns it to the theme's own value.
 */
export function ThemeEditor({settings, onChange}: Readonly<Props>) {
    const [selected, setSelected] = useState<ComponentKey>("body");
    const [fonts, setFonts] = useState<string[]>([]);
    const resolved = resolveComponents(settings);
    const style = resolved[selected];
    const edited = new Set(Object.keys(settings.components) as ComponentKey[]);

    useEffect(() => {
        systemFonts().then(setFonts);
    }, []);

    const setProperty = (property: keyof ComponentStyle, value: string) => {
        onChange({
            ...settings,
            components: {
                ...settings.components,
                [selected]: {...settings.components[selected], [property]: value},
            },
        });
    };

    const resetComponent = (key: ComponentKey) => {
        const {[key]: _dropped, ...rest} = settings.components;
        onChange({...settings, components: rest});
    };

    return (
        <div className="theme-editor">
            <p className="dialog-hint">
                Layered over <strong>{themeDef(settings.theme).label}</strong>. Reset a
                component to return it to the theme's own styling.
            </p>

            <div className="theme-grid">
                <div className="theme-components">
                    {COMPONENTS.map((key) => (
                        <button
                            key={key}
                            className={`theme-component${key === selected ? " active" : ""}`}
                            onClick={() => setSelected(key)}
                        >
                            <span>{COMPONENT_LABELS[key]}</span>
                            {edited.has(key) && <span className="badge">edited</span>}
                        </button>
                    ))}
                </div>

                <div className="theme-fields">
                    <div className="theme-fields-head">
                        <span>{COMPONENT_LABELS[selected]}</span>
                        {edited.has(selected) && (
                            <button
                                className="icon-btn"
                                title="Reset to the theme's styling"
                                onClick={() => resetComponent(selected)}
                            >
                                <RotateCcw size={13}/>
                            </button>
                        )}
                    </div>

                    {FIELDS.map((field) => (
                        <label key={field.key} className="field">
                            <span>{field.label}</span>
                            {field.key === "fontFamily" ? (
                                <FontSelect
                                    value={style.fontFamily ?? ""}
                                    fonts={fonts}
                                    onChange={(next) => setProperty("fontFamily", next)}
                                />
                            ) : field.key === "backgroundColor" ? (
                                // A colour input has no way to say "no background", so
                                // None sits beside it rather than being unreachable.
                                <div className="field-row">
                                    <input
                                        type="color"
                                        value={toHex(style.backgroundColor, "--bg")}
                                        onChange={(e) =>
                                            setProperty("backgroundColor", e.target.value)
                                        }
                                    />
                                    <button
                                        className={`btn${isTransparent(style.backgroundColor) ? " primary" : ""}`}
                                        title="No background"
                                        onClick={() =>
                                            setProperty("backgroundColor", "transparent")
                                        }
                                    >
                                        None
                                    </button>
                                </div>
                            ) : (
                                <input
                                    type={field.type}
                                    value={
                                        field.type === "color"
                                            ? toHex(style[field.key])
                                            : (style[field.key] ?? "")
                                    }
                                    placeholder={field.placeholder}
                                    onChange={(e) => setProperty(field.key, e.target.value)}
                                />
                            )}
                        </label>
                    ))}

                    <div
                        className="theme-preview"
                        style={{
                            backgroundColor: style.backgroundColor,
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
