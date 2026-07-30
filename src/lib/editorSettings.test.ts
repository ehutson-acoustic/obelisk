import {describe, expect, it} from "vitest";
import {contrastRatio, readableFg} from "./contrast";
import {
    BASE,
    DEFAULT_EDITOR_SETTINGS,
    DEFAULT_THEME,
    type EditorSettings,
    mergeSettings,
    type Palette,
    paletteCss,
    resolveComponents,
    scaled,
    sparseOverrides,
    stepZoom,
    themeCss,
    themeDef,
    THEMES,
} from "./editorSettings";

const app: EditorSettings = {...DEFAULT_EDITOR_SETTINGS};

describe("resolveComponents", () => {
    it("falls back to the base styling on the default theme", () => {
        expect(resolveComponents(app).h1).toEqual(BASE.h1);
    });

    it("layers a theme over the base, keeping unset properties", () => {
        const paper = resolveComponents({...app, theme: "paper"});
        expect(paper.body.fontFamily).toContain("Georgia");
        // Paper only sets family/size/line-height on body, so weight survives.
        expect(paper.body.fontWeight).toBe(BASE.body.fontWeight);
    });

    it("lets per-component edits win over the theme", () => {
        const resolved = resolveComponents({
            ...app,
            theme: "paper",
            components: {body: {fontFamily: "Comic Sans MS"}},
        });
        expect(resolved.body.fontFamily).toBe("Comic Sans MS");
        // The rest of Paper's body styling is untouched by that one edit.
        expect(resolved.body.fontSize).toBe("17px");
    });

    it("ignores empty strings so a cleared field falls back rather than blanking", () => {
        const resolved = resolveComponents({
            ...app,
            components: {h1: {fontSize: ""}},
        });
        expect(resolved.h1.fontSize).toBe(BASE.h1.fontSize);
    });

    it("falls back to the default theme for an unknown id", () => {
        expect(themeDef("no-such-theme")).toBe(THEMES[DEFAULT_THEME]);
        expect(resolveComponents({...app, theme: "no-such-theme"}).h1).toEqual(
            BASE.h1,
        );
    });
});

describe("project overrides", () => {
    it("applies the two overridable scalars and nothing else", () => {
        const merged = mergeSettings(app, {
            checkpointIntervalMinutes: 10,
            terminalStartupCommand: "claude",
        });
        expect(merged.checkpointIntervalMinutes).toBe(10);
        expect(merged.terminalStartupCommand).toBe("claude");
        // Styling is app-wide (DESIGN §5.2), so it must survive the merge intact.
        expect(merged.theme).toBe(app.theme);
        expect(merged.components).toBe(app.components);
    });

    it("returns the app settings unchanged for empty or absent overrides", () => {
        expect(mergeSettings(app, null)).toBe(app);
        expect(mergeSettings(app, {})).toEqual(app);
    });

    it("sparseOverrides keeps only real differences", () => {
        expect(sparseOverrides(app, app)).toEqual({});
        expect(
            sparseOverrides(app, {...app, checkpointIntervalMinutes: 15}),
        ).toEqual({checkpointIntervalMinutes: 15});
    });

    it("round-trips through merge and back out", () => {
        const effective = {...app, terminalStartupCommand: "claude --resume"};
        const overrides = sparseOverrides(app, effective);
        expect(mergeSettings(app, overrides).terminalStartupCommand).toBe(
            "claude --resume",
        );
    });
});

describe("stepZoom", () => {
    it("moves one step at a time through the scale", () => {
        expect(stepZoom(1, 1)).toBe(1.1);
        expect(stepZoom(1, -1)).toBe(0.9);
        expect(stepZoom(1.1, 1)).toBe(1.25);
    });

    it("clamps rather than running off either end", () => {
        expect(stepZoom(2, 1)).toBe(2);
        expect(stepZoom(0.67, -1)).toBe(0.67);
    });

    it("snaps a value that is not on the scale to its neighbour", () => {
        // A session saved by an older build, or hand-edited.
        expect(stepZoom(1.13, 1)).toBe(1.25);
        expect(stepZoom(5, -1)).toBe(1.75);
    });
});

describe("scaled", () => {
    it("multiplies absolute lengths by the zoom variable", () => {
        expect(scaled("16px")).toBe("calc(16px * var(--editor-zoom, 1))");
        expect(scaled("1.5rem")).toBe("calc(1.5rem * var(--editor-zoom, 1))");
    });

    it("leaves relative values alone, since they scale with their parent", () => {
        for (const value of ["inherit", "0.9em", "120%", "1.7"]) {
            expect(scaled(value)).toBe(value);
        }
    });
});

describe("themeCss", () => {
    it("scales font sizes but not line heights or colors", () => {
        const css = themeCss(app);
        expect(css).toContain("font-size: calc(16px * var(--editor-zoom, 1))");
        expect(css).toContain("line-height: 1.7");
        expect(css).toContain("color: var(--fg)");
    });

    it("emits inline code's em size unscaled, so it tracks its context", () => {
        expect(themeCss(app)).toContain("font-size: 0.9em");
    });

    it("out-specifies Crepe by targeting paragraphs as well as the container", () => {
        expect(themeCss(app)).toContain(".milkdown .ProseMirror p");
    });

    it("gives inline code the theme's own recessed surface, not Crepe's fill", () => {
        expect(themeCss(app)).toContain("background-color: var(--bg-sunken)");
    });

    it("emits a background set on any component", () => {
        const css = themeCss({
            ...app,
            components: {blockquote: {backgroundColor: "#ff0000"}},
        });
        expect(css).toContain("background-color: #ff0000");
    });

    it("omits a background nobody set, rather than forcing one", () => {
        // h1 has no background in BASE, so no declaration should appear for it.
        const h1Block = themeCss(app)
            .split("\n\n")
            .find((block) => block.startsWith(".milkdown .ProseMirror h1"));
        expect(h1Block).toBeDefined();
        expect(h1Block).not.toContain("background-color");
    });
});

describe("paletteCss", () => {
    it("emits both modes as attribute selectors so they beat the stylesheet", () => {
        const css = paletteCss({...app, theme: "paper"});
        expect(css).toContain(':root[data-theme="light"]');
        expect(css).toContain(':root[data-theme="dark"]');
        expect(css).toContain("--bg: #faf6ef");
        expect(css).toContain("--bg: #211d19");
    });

    it("declares color-scheme per mode so native widgets follow", () => {
        expect(paletteCss(app)).toContain("color-scheme: dark");
    });

    /**
     * The primary button's label sits on the accent. Dark themes carry light
     * accents, so a hardcoded white would be unreadable in half the roster.
     */
    it("derives a readable foreground for the accent in every theme and mode", () => {
        for (const [id, theme] of Object.entries(THEMES)) {
            const css = paletteCss({...app, theme: id});
            const emitted = [...css.matchAll(/--accent-fg: (#[0-9a-f]{6});/g)].map(
                (m) => m[1],
            );
            expect(emitted).toHaveLength(2);
            expect(emitted[0]).toBe(readableFg(theme.light.accent));
            expect(emitted[1]).toBe(readableFg(theme.dark.accent));
            for (const [fg, palette] of [
                [emitted[0], theme.light],
                [emitted[1], theme.dark],
            ] as const) {
                expect(contrastRatio(fg, palette.accent)).toBeGreaterThanOrEqual(4.5);
            }
        }
    });

    /**
     * A theme may not constrain the editor's width. Every theme fills the panel
     * exactly as the original does (DESIGN §5.3) — a per-theme measure was tried
     * and removed, so no theme may reintroduce one through this stylesheet.
     */
    it("never constrains the editor width", () => {
        for (const id of Object.keys(THEMES)) {
            const css = paletteCss({...app, theme: id});
            expect(css).not.toContain("--content-width");
            expect(css).not.toContain("max-width");
        }
    });
});

/**
 * Twelve hand-picked palettes is exactly the sort of data that rots silently, so
 * the floors are asserted rather than trusted: WCAG AAA for body text, AA for
 * muted text and accents. A theme that fails here is unusable, not merely ugly.
 */
describe("theme palettes", () => {
    const modes: ("light" | "dark")[] = ["light", "dark"];

    it.each(Object.entries(THEMES))("%s meets the contrast floors", (_id, theme) => {
        for (const mode of modes) {
            const p: Palette = theme[mode];
            expect(contrastRatio(p.fg, p.bg)).toBeGreaterThanOrEqual(7);
            expect(contrastRatio(p.fgMuted, p.bg)).toBeGreaterThanOrEqual(4.5);
            expect(contrastRatio(p.accent, p.bg)).toBeGreaterThanOrEqual(4.5);
            expect(contrastRatio(p.danger, p.bg)).toBeGreaterThanOrEqual(4.5);
            // Muted text sits on sunken and raised surfaces too, not just `bg`.
            expect(contrastRatio(p.fgMuted, p.bgSunken)).toBeGreaterThanOrEqual(4.5);
            expect(contrastRatio(p.fgMuted, p.bgRaised)).toBeGreaterThanOrEqual(4.5);
        }
    });

    it.each(Object.entries(THEMES))("%s defines every variable", (_id, theme) => {
        const keys = Object.keys(THEMES[DEFAULT_THEME].light).sort();
        for (const mode of modes) {
            expect(Object.keys(theme[mode]).sort()).toEqual(keys);
            for (const value of Object.values(theme[mode])) {
                // A palette entry must be a literal colour; `var(--x)` here would
                // resolve against whatever it happened to be replacing.
                expect(value).toMatch(/^#[0-9a-f]{6}$/i);
            }
        }
    });

    it("keeps light modes light and dark modes dark", () => {
        for (const theme of Object.values(THEMES)) {
            expect(contrastRatio(theme.light.bg, "#ffffff")).toBeLessThan(1.5);
            expect(contrastRatio(theme.dark.bg, "#000000")).toBeLessThan(1.7);
        }
    });
});
