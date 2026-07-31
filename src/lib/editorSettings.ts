/**
 * Themes, Markdown styling, and the project-overridable settings (DESIGN §5).
 *
 * A **theme** (§5.3) is the whole look: a light and a dark palette, a typography
 * baseline, and a content measure. It replaced the earlier "preset" concept,
 * which covered typography only and left a theme like Paper unable to actually
 * be paper. Markdown styling still layers — `BASE ⊕ theme ⊕ the user's own
 * per-component edits` — so a theme is a starting point, not a cage.
 *
 * Theme and light/dark/system are independent: every theme defines both modes.
 */

import {readableFg} from "./contrast";

export const COMPONENTS = [
    "body",
    "h1",
    "h2",
    "h3",
    "link",
    "inlineCode",
    "codeBlock",
    "blockquote",
    "list",
] as const;

export type ComponentKey = (typeof COMPONENTS)[number];

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
    body: "Body text",
    h1: "Heading 1",
    h2: "Heading 2",
    h3: "Heading 3",
    link: "Links",
    inlineCode: "Inline code",
    codeBlock: "Code blocks",
    blockquote: "Block quote",
    list: "Lists",
};

/** The bounded property set from DESIGN §5.3 — deliberately not open-ended. */
export type ComponentStyle = {
    fontFamily?: string;
    fontSize?: string;
    fontWeight?: string;
    color?: string;
    backgroundColor?: string;
    lineHeight?: string;
};

export type ComponentMap = Partial<Record<ComponentKey, ComponentStyle>>;

export type EditorSettings = {
    /** Key into `THEMES`. */
    theme: string;
    /** Per-component edits layered over the theme. */
    components: ComponentMap;
    checkpointIntervalMinutes: number;
    terminalStartupCommand: string;
};

/**
 * Only these may be set per project (DESIGN §5.2). Styling is deliberately not
 * among them: a per-project look meant the app changed appearance as you moved
 * between projects, which read as a bug rather than a feature.
 */
export type ProjectOverrides = Partial<
    Pick<EditorSettings, "checkpointIntervalMinutes" | "terminalStartupCommand">
>;

const SANS = "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif";
const SERIF = "Georgia, \"Iowan Old Style\", \"Times New Roman\", serif";
const MONO = "ui-monospace, SFMono-Regular, \"SF Mono\", Menlo, monospace";

/**
 * The stacks the built-in themes are written in. Offered alongside the installed
 * fonts so a component can be put back to a themed default after someone picks a
 * specific face — otherwise these become unreachable the moment you change one.
 */
export const DEFAULT_FAMILIES: { label: string; value: string }[] = [
    {label: "Inherit", value: "inherit"},
    {label: "Default sans", value: SANS},
    {label: "Default serif", value: SERIF},
    {label: "Default mono", value: MONO},
];

/** Resolved styling every theme starts from. */
export const BASE: Record<ComponentKey, ComponentStyle> = {
    body: {
        fontFamily: SANS,
        fontSize: "16px",
        fontWeight: "400",
        color: "var(--fg)",
        lineHeight: "1.7",
    },
    h1: {
        fontFamily: SANS,
        fontSize: "30px",
        fontWeight: "700",
        color: "var(--fg)",
        lineHeight: "1.3",
    },
    h2: {
        fontFamily: SANS,
        fontSize: "24px",
        fontWeight: "650",
        color: "var(--fg)",
        lineHeight: "1.3",
    },
    h3: {
        fontFamily: SANS,
        fontSize: "19px",
        fontWeight: "600",
        color: "var(--fg)",
        lineHeight: "1.4",
    },
    link: {
        fontFamily: "inherit",
        fontSize: "inherit",
        fontWeight: "inherit",
        color: "var(--accent)",
        lineHeight: "inherit",
    },
    inlineCode: {
        fontFamily: MONO,
        fontSize: "0.9em",
        fontWeight: "400",
        color: "var(--fg)",
        // Crepe's stock inline-code background is a flat, saturated fill that
        // fights every one of these palettes. The sunken surface is the theme's
        // own answer to "slightly recessed", so it recolours per theme for free.
        backgroundColor: "var(--bg-sunken)",
        lineHeight: "inherit",
    },
    codeBlock: {
        fontFamily: MONO,
        fontSize: "13px",
        fontWeight: "400",
        color: "var(--fg)",
        lineHeight: "1.6",
    },
    blockquote: {
        fontFamily: "inherit",
        fontSize: "inherit",
        fontWeight: "400",
        color: "var(--fg-muted)",
        lineHeight: "1.7",
    },
    list: {
        fontFamily: "inherit",
        fontSize: "inherit",
        fontWeight: "400",
        color: "var(--fg)",
        lineHeight: "1.7",
    },
};

/**
 * The CSS variables `styles/base.css` styles the whole app against. A theme supplies
 * every one for both modes rather than inheriting some, so no palette can be
 * half-applied.
 */
export type Palette = {
    bg: string;
    bgSunken: string;
    bgRaised: string;
    border: string;
    borderStrong: string;
    fg: string;
    fgMuted: string;
    accent: string;
    danger: string;
    termBg: string;
    bannerBg: string;
    bannerBorder: string;
};

export type ThemeDef = {
    label: string;
    /** One line, shown under the name in the picker. */
    description: string;
    /** Typography baseline, layered over `BASE`. */
    components: ComponentMap;
    light: Palette;
    dark: Palette;
};

/**
 * Contrast floors these palettes are held to by `editorSettings.test.ts`:
 * body text 7:1 (WCAG AAA), muted text and accents 4.5:1 (AA).
 */
export const THEMES: Record<string, ThemeDef> = {
    obelisk: {
        label: "Obelisk",
        description: "Neutral greys with a green accent.",
        components: {},
        light: {
            bg: "#ffffff",
            bgSunken: "#f4f5f7",
            bgRaised: "#fafbfc",
            border: "#e1e4e8",
            borderStrong: "#cdd2d8",
            fg: "#1f2328",
            // Was #6b7280, which measured 4.43:1 against `bgSunken` — just under
            // AA. Same hue, one step darker; the difference is imperceptible.
            fgMuted: "#666d7a",
            accent: "#2f6f4e",
            danger: "#b42318",
            termBg: "#ffffff",
            bannerBg: "#fff8e1",
            bannerBorder: "#f0d68a",
        },
        dark: {
            bg: "#16181d",
            bgSunken: "#1b1e24",
            bgRaised: "#1f232a",
            border: "#2b3038",
            borderStrong: "#3a414b",
            fg: "#e4e6eb",
            fgMuted: "#9aa1ad",
            accent: "#5fb98a",
            danger: "#f2807a",
            termBg: "#1e2128",
            bannerBg: "#3a3320",
            bannerBorder: "#6b5a24",
        },
    },

    paper: {
        label: "Paper",
        description: "Warm cream and ink, serif, narrow measure.",
        components: {
            body: {fontFamily: SERIF, fontSize: "17px", lineHeight: "1.75"},
            h1: {fontFamily: SERIF, fontWeight: "700"},
            h2: {fontFamily: SERIF, fontWeight: "700"},
            h3: {fontFamily: SERIF, fontWeight: "700"},
            blockquote: {fontFamily: SERIF},
            list: {lineHeight: "1.75"},
        },
        light: {
            bg: "#faf6ef",
            bgSunken: "#f2ece1",
            bgRaised: "#fdfbf7",
            border: "#e4dccd",
            borderStrong: "#cdc2ad",
            fg: "#2b2622",
            fgMuted: "#6f6659",
            accent: "#8c5a2b",
            danger: "#a3352b",
            termBg: "#faf6ef",
            bannerBg: "#fbf0d5",
            bannerBorder: "#e0cba0",
        },
        dark: {
            bg: "#211d19",
            bgSunken: "#1a1714",
            bgRaised: "#292420",
            border: "#383129",
            borderStrong: "#4a4137",
            fg: "#ece4d6",
            fgMuted: "#a89a86",
            accent: "#d9a366",
            danger: "#e88b7d",
            termBg: "#211d19",
            bannerBg: "#3a2f1c",
            bannerBorder: "#6b5528",
        },
    },

    focus: {
        label: "Focus",
        description: "Near-monochrome and roomy. The distraction-free one.",
        components: {
            body: {fontSize: "17px", lineHeight: "1.85"},
            h1: {fontWeight: "600"},
            h2: {fontWeight: "600"},
            h3: {fontWeight: "600"},
            list: {lineHeight: "1.85"},
            blockquote: {lineHeight: "1.85"},
        },
        light: {
            bg: "#ffffff",
            bgSunken: "#f7f7f7",
            bgRaised: "#fcfcfc",
            border: "#ebebeb",
            borderStrong: "#d6d6d6",
            fg: "#1a1a1a",
            fgMuted: "#6e6e6e",
            accent: "#444444",
            danger: "#8f2c22",
            termBg: "#ffffff",
            bannerBg: "#f4f4f4",
            bannerBorder: "#d6d6d6",
        },
        dark: {
            bg: "#131313",
            bgSunken: "#191919",
            bgRaised: "#1e1e1e",
            border: "#2a2a2a",
            borderStrong: "#3a3a3a",
            fg: "#e8e8e8",
            fgMuted: "#9a9a9a",
            accent: "#c8c8c8",
            danger: "#e8857a",
            termBg: "#131313",
            bannerBg: "#2a2a2a",
            bannerBorder: "#3f3f3f",
        },
    },

    calm: {
        label: "Calm",
        description: "Desaturated sage, soft contrast, generous spacing.",
        components: {
            body: {lineHeight: "1.85"},
            h1: {fontWeight: "650"},
            h2: {fontWeight: "600"},
            list: {lineHeight: "1.85"},
            blockquote: {lineHeight: "1.85"},
        },
        light: {
            bg: "#f4f7f5",
            bgSunken: "#e9efeb",
            bgRaised: "#fafcfb",
            border: "#d8e2dc",
            borderStrong: "#bccbc3",
            fg: "#253029",
            fgMuted: "#5f6f66",
            accent: "#35705e",
            danger: "#a63d34",
            termBg: "#f4f7f5",
            bannerBg: "#f5f2e0",
            bannerBorder: "#d8d0aa",
        },
        dark: {
            bg: "#171d1a",
            bgSunken: "#1c2320",
            bgRaised: "#212926",
            border: "#2c3733",
            borderStrong: "#3c4a45",
            fg: "#dde5e0",
            fgMuted: "#94a39c",
            accent: "#6fb79f",
            danger: "#ee8b80",
            termBg: "#171d1a",
            bannerBg: "#2f3320",
            bannerBorder: "#575d34",
        },
    },

    contrast: {
        label: "Contrast",
        description: "Maximum legibility, sharp borders.",
        components: {
            h1: {fontWeight: "700"},
            h2: {fontWeight: "700"},
            h3: {fontWeight: "700"},
        },
        light: {
            bg: "#ffffff",
            bgSunken: "#f0f0f0",
            bgRaised: "#ffffff",
            border: "#767676",
            borderStrong: "#1a1a1a",
            fg: "#000000",
            fgMuted: "#454545",
            accent: "#0b57d0",
            danger: "#9a0000",
            termBg: "#ffffff",
            bannerBg: "#fff4c2",
            bannerBorder: "#8a6d00",
        },
        dark: {
            bg: "#000000",
            bgSunken: "#121212",
            bgRaised: "#0a0a0a",
            border: "#8a8a8a",
            borderStrong: "#e0e0e0",
            fg: "#ffffff",
            fgMuted: "#c6c6c6",
            accent: "#7cb0ff",
            danger: "#ff9d9d",
            termBg: "#000000",
            bannerBg: "#2b2400",
            bannerBorder: "#c2a300",
        },
    },

    ink: {
        label: "Ink",
        description: "Cool blue-grey with mono headings, for technical notes.",
        components: {
            body: {fontSize: "15px", lineHeight: "1.65"},
            h1: {fontFamily: MONO, fontSize: "26px", fontWeight: "600"},
            h2: {fontFamily: MONO, fontSize: "21px", fontWeight: "600"},
            h3: {fontFamily: MONO, fontSize: "17px", fontWeight: "600"},
            list: {lineHeight: "1.65"},
        },
        light: {
            bg: "#f7f9fb",
            bgSunken: "#eef2f6",
            bgRaised: "#fcfdfe",
            border: "#dde4ec",
            borderStrong: "#c0cbd8",
            fg: "#1b2430",
            fgMuted: "#5d6b7c",
            accent: "#2b5f9e",
            danger: "#b03030",
            termBg: "#f7f9fb",
            bannerBg: "#fdf3dd",
            bannerBorder: "#dfc99a",
        },
        dark: {
            bg: "#12171e",
            bgSunken: "#171d25",
            bgRaised: "#1b222b",
            border: "#262f3a",
            borderStrong: "#36414f",
            fg: "#dde4ec",
            fgMuted: "#8d9aab",
            accent: "#74a8e8",
            danger: "#ef8b8b",
            termBg: "#12171e",
            bannerBg: "#2c2a1a",
            bannerBorder: "#5a5330",
        },
    },
};

export const DEFAULT_THEME = "obelisk";

export function themeDef(id: string): ThemeDef {
    return THEMES[id] ?? THEMES[DEFAULT_THEME];
}

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
    theme: DEFAULT_THEME,
    components: {},
    checkpointIntervalMinutes: 5,
    terminalStartupCommand: "",
};

function mergeStyle(
    base: ComponentStyle,
    ...layers: (ComponentStyle | undefined)[]
): ComponentStyle {
    let out = {...base};
    for (const layer of layers) {
        if (!layer) continue;
        for (const [key, value] of Object.entries(layer)) {
            if (value !== undefined && value !== "") {
                out = {...out, [key]: value};
            }
        }
    }
    return out;
}

/** Base ⊕ theme ⊕ per-component edits. */
export function resolveComponents(
    settings: EditorSettings,
): Record<ComponentKey, ComponentStyle> {
    const theme = themeDef(settings.theme).components;
    const out = {} as Record<ComponentKey, ComponentStyle>;
    for (const key of COMPONENTS) {
        out[key] = mergeStyle(BASE[key], theme[key], settings.components[key]);
    }
    return out;
}

/** App defaults with the project's sparse overrides applied. */
export function mergeSettings(
    app: EditorSettings,
    overrides: ProjectOverrides | null | undefined,
): EditorSettings {
    if (!overrides) return app;
    return {
        ...app,
        checkpointIntervalMinutes:
            overrides.checkpointIntervalMinutes ?? app.checkpointIntervalMinutes,
        terminalStartupCommand:
            overrides.terminalStartupCommand ?? app.terminalStartupCommand,
    };
}

/** Keeps only what differs from `app`, so stored project files stay small. */
export function sparseOverrides(
    app: EditorSettings,
    effective: EditorSettings,
): ProjectOverrides {
    const out: ProjectOverrides = {};
    if (effective.checkpointIntervalMinutes !== app.checkpointIntervalMinutes) {
        out.checkpointIntervalMinutes = effective.checkpointIntervalMinutes;
    }
    if (effective.terminalStartupCommand !== app.terminalStartupCommand) {
        out.terminalStartupCommand = effective.terminalStartupCommand;
    }
    return out;
}

/**
 * Written against the DOM Crepe actually produces, which is not plain HTML:
 * paragraphs carry their own size and line-height from Crepe's stylesheet, and
 * code blocks are CodeMirror instances rather than `<pre>`. Every selector here
 * has to out-specify Crepe's own rule for the same element.
 */
const SELECTORS: Record<ComponentKey, string> = {
    // The container alone would never reach body text (Crepe styles `p`
    // directly) while still leaking its size into code blocks, which inherit.
    body: ".milkdown .ProseMirror, .milkdown .ProseMirror p",
    h1: ".milkdown .ProseMirror h1",
    h2: ".milkdown .ProseMirror h2",
    h3: ".milkdown .ProseMirror h3",
    link: ".milkdown .ProseMirror a",
    inlineCode: ".milkdown .ProseMirror code:not(pre code)",
    // No `<pre>` exists — the block is a CodeMirror editor, with a plain
    // element standing in until it mounts.
    codeBlock:
        ".milkdown .milkdown-code-block .cm-scroller," +
        " .milkdown .milkdown-code-block .milkdown-code-block-placeholder",
    // Both of these wrap paragraphs, so they need the extra element to beat the
    // `p` half of the body rule.
    blockquote:
        ".milkdown .ProseMirror blockquote, .milkdown .ProseMirror blockquote p",
    list: ".milkdown .ProseMirror li, .milkdown .ProseMirror li p",
};

const CSS_PROPS: Record<keyof ComponentStyle, string> = {
    fontFamily: "font-family",
    fontSize: "font-size",
    fontWeight: "font-weight",
    color: "color",
    backgroundColor: "background-color",
    lineHeight: "line-height",
};

/**
 * Zoom levels, matching what browsers offer (DESIGN §7). Discrete rather than a
 * multiplier per keypress so Ctrl+= and Ctrl+- are reversible and land on round
 * numbers.
 */
export const ZOOM_STEPS = [0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
export const DEFAULT_ZOOM = 1;

/** One step up or down, clamped at both ends. Snaps an off-scale value inward. */
export function stepZoom(current: number, direction: number): number {
    const nearest = ZOOM_STEPS.reduce((best, step) =>
        Math.abs(step - current) < Math.abs(best - current) ? step : best,
    );
    const index = ZOOM_STEPS.indexOf(nearest) + direction;
    return ZOOM_STEPS[Math.min(Math.max(index, 0), ZOOM_STEPS.length - 1)];
}

/** Absolute lengths only. `em`, `%` and `inherit` already scale with the parent. */
const ABSOLUTE_LENGTH = /^-?(?:\d+\.?\d*|\.\d+)(?:px|rem|pt)$/;

/**
 * Multiplies absolute font sizes by `--editor-zoom` (DESIGN §7). Expressed in
 * the stylesheet rather than applied in JS so Ctrl+= is a single variable write
 * with no restyling pass of our own — and so CodeMirror, which reads computed
 * styles, sees a real font-size change it can measure against.
 */
export function scaled(value: string): string {
    return ABSOLUTE_LENGTH.test(value.trim())
        ? `calc(${value.trim()} * var(--editor-zoom, 1))`
        : value;
}

/** Stylesheet text for the resolved component map. */
export function themeCss(settings: EditorSettings): string {
    const resolved = resolveComponents(settings);
    const blocks: string[] = [];

    for (const key of COMPONENTS) {
        const declarations = Object.entries(resolved[key])
            .filter(([, value]) => value !== undefined && value !== "")
            .map(([prop, value]) => {
                const property = CSS_PROPS[prop as keyof ComponentStyle];
                return `  ${property}: ${prop === "fontSize" ? scaled(value) : value};`;
            });
        if (declarations.length > 0) {
            blocks.push(`${SELECTORS[key]} {\n${declarations.join("\n")}\n}`);
        }
    }

    return blocks.join("\n\n");
}

const PALETTE_VARS: Record<keyof Palette, string> = {
    bg: "--bg",
    bgSunken: "--bg-sunken",
    bgRaised: "--bg-raised",
    border: "--border",
    borderStrong: "--border-strong",
    fg: "--fg",
    fgMuted: "--fg-muted",
    accent: "--accent",
    danger: "--danger",
    termBg: "--term-bg",
    bannerBg: "--banner-bg",
    bannerBorder: "--banner-border",
};

/**
 * The active theme's palette, as `:root[data-theme=…]` rules.
 *
 * Both modes are emitted under an attribute selector deliberately: `styles/base.css`
 * declares its own defaults on a bare `:root` (light) and `:root[data-theme="dark"]`,
 * so matching the *attribute* form is what makes these win in both directions —
 * higher specificity than the bare rule, and later in the document than the dark
 * one.
 */
export function paletteCss(settings: EditorSettings): string {
    const theme = themeDef(settings.theme);
    const block = (mode: "light" | "dark") => {
        const palette = theme[mode];
        const vars = (Object.keys(PALETTE_VARS) as (keyof Palette)[])
            .map((key) => `  ${PALETTE_VARS[key]}: ${palette[key]};`)
            .join("\n");
        // Anything sitting *on* the accent — the primary button's label — needs a
        // foreground picked from the accent's luminance. Dark themes carry light
        // accents, so a hardcoded white is unreadable in half the roster.
        const accentFg = `  --accent-fg: ${readableFg(palette.accent)};`;
        return `:root[data-theme="${mode}"] {\n${vars}\n${accentFg}\n  color-scheme: ${mode};\n}`;
    };
    return [block("light"), block("dark")].join("\n\n");
}
