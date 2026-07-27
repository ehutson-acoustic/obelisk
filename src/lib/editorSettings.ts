/**
 * Markdown styling and the project-overridable settings (DESIGN §5).
 *
 * Everything here is layered: a built-in base, then the chosen preset, then
 * the user's own per-component edits. Project settings are stored sparsely —
 * only keys that actually differ — so improvements to the defaults keep
 * flowing through to existing projects.
 */

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
    lineHeight?: string;
};

export type ComponentMap = Partial<Record<ComponentKey, ComponentStyle>>;

export type EditorSettings = {
    preset: string;
    /** Per-component edits layered over the preset. */
    components: ComponentMap;
    checkpointIntervalMinutes: number;
    terminalStartupCommand: string;
};

/** Only these may be set per project (DESIGN §5.2). */
export type ProjectOverrides = Partial<EditorSettings>;

const SANS = "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif";
const SERIF = "Georgia, \"Iowan Old Style\", \"Times New Roman\", serif";
const MONO = "ui-monospace, SFMono-Regular, \"SF Mono\", Menlo, monospace";

/**
 * The stacks the built-in presets are written in. Offered alongside the
 * installed fonts so a component can be put back to a themed default after
 * someone picks a specific face — otherwise these become unreachable the moment
 * you change one.
 */
export const DEFAULT_FAMILIES: { label: string; value: string }[] = [
    {label: "Inherit", value: "inherit"},
    {label: "Default sans", value: SANS},
    {label: "Default serif", value: SERIF},
    {label: "Default mono", value: MONO},
];

/** Resolved styling every preset starts from. */
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

export const PRESETS: Record<string, { label: string; components: ComponentMap }> =
    {
        default: {label: "Default", components: {}},
        serif: {
            label: "Serif",
            components: {
                body: {fontFamily: SERIF, fontSize: "17px", lineHeight: "1.75"},
                h1: {fontFamily: SERIF},
                h2: {fontFamily: SERIF},
                h3: {fontFamily: SERIF},
                blockquote: {fontFamily: SERIF},
            },
        },
        compact: {
            label: "Compact",
            components: {
                body: {fontSize: "14px", lineHeight: "1.5"},
                h1: {fontSize: "24px"},
                h2: {fontSize: "20px"},
                h3: {fontSize: "17px"},
                codeBlock: {fontSize: "12px", lineHeight: "1.45"},
                list: {lineHeight: "1.5"},
            },
        },
    };

export const CUSTOM_PRESET = "custom";

export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
    preset: "default",
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

/** Base ⊕ preset ⊕ per-component edits. */
export function resolveComponents(
    settings: EditorSettings,
): Record<ComponentKey, ComponentStyle> {
    const preset = PRESETS[settings.preset]?.components ?? {};
    const out = {} as Record<ComponentKey, ComponentStyle>;
    for (const key of COMPONENTS) {
        out[key] = mergeStyle(BASE[key], preset[key], settings.components[key]);
    }
    return out;
}

/**
 * App defaults with the project's sparse overrides applied. Component styles
 * merge per property, so a project can override one color without restating
 * the rest.
 */
export function mergeSettings(
    app: EditorSettings,
    overrides: ProjectOverrides | null | undefined,
): EditorSettings {
    if (!overrides) return app;

    const components: ComponentMap = {...app.components};
    for (const key of COMPONENTS) {
        const override = overrides.components?.[key];
        if (!override) continue;
        components[key] = mergeStyle(app.components[key] ?? {}, override);
    }

    return {
        preset: overrides.preset ?? app.preset,
        components,
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

    if (effective.preset !== app.preset) out.preset = effective.preset;
    if (effective.checkpointIntervalMinutes !== app.checkpointIntervalMinutes) {
        out.checkpointIntervalMinutes = effective.checkpointIntervalMinutes;
    }
    if (effective.terminalStartupCommand !== app.terminalStartupCommand) {
        out.terminalStartupCommand = effective.terminalStartupCommand;
    }

    const components: ComponentMap = {};
    for (const key of COMPONENTS) {
        const mine = effective.components[key];
        if (!mine) continue;
        const theirs = app.components[key] ?? {};
        const diff: ComponentStyle = {};
        for (const [prop, value] of Object.entries(mine)) {
            if (value !== theirs[prop as keyof ComponentStyle]) {
                diff[prop as keyof ComponentStyle] = value;
            }
        }
        if (Object.keys(diff).length > 0) components[key] = diff;
    }
    if (Object.keys(components).length > 0) out.components = components;

    return out;
}

/**
 * DESIGN §5.3 — editing a shipped preset forks it into "Custom" rather than
 * silently redefining a named preset.
 */
export function forkToCustom(settings: EditorSettings): EditorSettings {
    if (settings.preset === CUSTOM_PRESET) return settings;
    const resolved = resolveComponents(settings);
    return {...settings, preset: CUSTOM_PRESET, components: resolved};
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
    lineHeight: "line-height",
};

/** Stylesheet text for the resolved component map. */
export function themeCss(settings: EditorSettings): string {
    const resolved = resolveComponents(settings);
    const blocks: string[] = [];

    for (const key of COMPONENTS) {
        const declarations = Object.entries(resolved[key])
            .filter(([, value]) => value !== undefined && value !== "")
            .map(
                ([prop, value]) =>
                    `  ${CSS_PROPS[prop as keyof ComponentStyle]}: ${value};`,
            );
        if (declarations.length > 0) {
            blocks.push(`${SELECTORS[key]} {\n${declarations.join("\n")}\n}`);
        }
    }

    return blocks.join("\n\n");
}
