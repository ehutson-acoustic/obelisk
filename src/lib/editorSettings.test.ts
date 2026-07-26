import {describe, expect, it} from "vitest";
import {
    BASE,
    CUSTOM_PRESET,
    DEFAULT_EDITOR_SETTINGS,
    type EditorSettings,
    forkToCustom,
    mergeSettings,
    resolveComponents,
    sparseOverrides,
    themeCss,
} from "./editorSettings";

const app: EditorSettings = {...DEFAULT_EDITOR_SETTINGS};

describe("resolveComponents", () => {
    it("falls back to the base styling with no preset or edits", () => {
        expect(resolveComponents(app).h1).toEqual(BASE.h1);
    });

    it("layers a preset over the base, keeping unset properties", () => {
        const serif = resolveComponents({...app, preset: "serif"});
        expect(serif.body.fontFamily).toContain("Georgia");
        // The preset only sets family/size/line-height, so weight survives.
        expect(serif.body.fontWeight).toBe(BASE.body.fontWeight);
    });

    it("lets per-component edits win over the preset", () => {
        const resolved = resolveComponents({
            ...app,
            preset: "compact",
            components: {body: {fontSize: "22px"}},
        });
        expect(resolved.body.fontSize).toBe("22px");
        expect(resolved.body.lineHeight).toBe("1.5"); // still from the preset
    });

    it("ignores empty strings so a cleared field falls back", () => {
        const resolved = resolveComponents({
            ...app,
            components: {h1: {color: ""}},
        });
        expect(resolved.h1.color).toBe(BASE.h1.color);
    });
});

describe("mergeSettings", () => {
    it("returns the app settings when a project overrides nothing", () => {
        expect(mergeSettings(app, null)).toBe(app);
        expect(mergeSettings(app, {})).toEqual(app);
    });

    it("applies scalar overrides only where present", () => {
        const merged = mergeSettings(app, {checkpointIntervalMinutes: 15});
        expect(merged.checkpointIntervalMinutes).toBe(15);
        expect(merged.terminalStartupCommand).toBe(app.terminalStartupCommand);
        expect(merged.preset).toBe(app.preset);
    });

    it("merges component overrides per property", () => {
        const withApp: EditorSettings = {
            ...app,
            components: {h1: {color: "#111", fontSize: "40px"}},
        };
        const merged = mergeSettings(withApp, {
            components: {h1: {color: "#c00"}},
        });
        expect(merged.components.h1).toEqual({color: "#c00", fontSize: "40px"});
    });

    it("does not mutate the app settings", () => {
        const withApp: EditorSettings = {
            ...app,
            components: {h1: {color: "#111"}},
        };
        mergeSettings(withApp, {components: {h1: {color: "#c00"}}});
        expect(withApp.components.h1).toEqual({color: "#111"});
    });

    it("lets a project keep a startup command the app leaves empty", () => {
        const merged = mergeSettings(app, {terminalStartupCommand: "claude"});
        expect(merged.terminalStartupCommand).toBe("claude");
    });
});

describe("sparseOverrides", () => {
    it("stores nothing when the project matches the app defaults", () => {
        expect(sparseOverrides(app, {...app})).toEqual({});
    });

    it("stores only the keys that differ", () => {
        const effective: EditorSettings = {
            ...app,
            checkpointIntervalMinutes: 10,
            terminalStartupCommand: "claude",
        };
        expect(sparseOverrides(app, effective)).toEqual({
            checkpointIntervalMinutes: 10,
            terminalStartupCommand: "claude",
        });
    });

    it("stores only the differing component properties", () => {
        const withApp: EditorSettings = {
            ...app,
            components: {h1: {color: "#111", fontSize: "40px"}},
        };
        const effective: EditorSettings = {
            ...withApp,
            components: {h1: {color: "#c00", fontSize: "40px"}},
        };
        expect(sparseOverrides(withApp, effective)).toEqual({
            components: {h1: {color: "#c00"}},
        });
    });

    it("round-trips through mergeSettings", () => {
        const effective: EditorSettings = {
            ...app,
            preset: "serif",
            checkpointIntervalMinutes: 20,
            components: {h2: {color: "#0a0"}},
        };
        const stored = sparseOverrides(app, effective);
        expect(mergeSettings(app, stored)).toEqual(effective);
    });
});

describe("forkToCustom", () => {
    it("freezes the resolved styling and switches to custom", () => {
        const forked = forkToCustom({...app, preset: "serif"});
        expect(forked.preset).toBe(CUSTOM_PRESET);
        expect(forked.components.body?.fontFamily).toContain("Georgia");
    });

    it("is a no-op once already custom", () => {
        const already: EditorSettings = {...app, preset: CUSTOM_PRESET};
        expect(forkToCustom(already)).toBe(already);
    });
});

describe("themeCss", () => {
    it("emits a rule per component scoped to the editor", () => {
        const css = themeCss(app);
        expect(css).toContain(".milkdown .ProseMirror h1 {");
        expect(css).toContain("font-size: 30px;");
        // Scoped to the WYSIWYG only — never the app chrome.
        expect(css).not.toMatch(/^\s*body\s*\{/m);
    });

    it("reflects per-component edits", () => {
        const css = themeCss({...app, components: {h1: {color: "#abcdef"}}});
        expect(css).toContain("color: #abcdef;");
    });
});
