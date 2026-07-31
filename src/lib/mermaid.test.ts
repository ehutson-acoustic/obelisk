// @vitest-environment jsdom
import {describe, expect, it} from "vitest";
import {contrastRatio} from "./contrast";
import {type Palette, THEMES} from "./editorSettings";
import {
    decodeSource,
    DIAGRAM_CLASS,
    DIAGRAM_SOURCE_ATTR,
    type DiagramStyle,
    diagramPreview,
    EDITING_CLASS,
    encodeSource,
    isMermaid,
    mermaidThemeVariables,
    pinSourceWhileEditing,
    sanitizeDiagram,
} from "./mermaid";
import type {Theme} from "./theme";

const styleFor = (palette: Palette, theme: Theme): DiagramStyle => ({
    theme,
    palette,
    fontFamily: "Inter, sans-serif",
    fontSize: "16px",
});

describe("isMermaid", () => {
    it("matches the fence GitHub honours, whatever the casing", () => {
        expect(isMermaid("mermaid")).toBe(true);
        expect(isMermaid("Mermaid")).toBe(true);
        expect(isMermaid(" mermaid ")).toBe(true);
    });

    it("does not match other languages or a bare fence", () => {
        expect(isMermaid("ts")).toBe(false);
        expect(isMermaid("mermaidjs")).toBe(false);
        expect(isMermaid("")).toBe(false);
        expect(isMermaid(null)).toBe(false);
        expect(isMermaid(undefined)).toBe(false);
    });
});

/**
 * The same floors `editorSettings.test.ts` holds the palettes to, applied to
 * the roles mermaid derives everything else from. A theme whose diagrams are
 * unreadable is a broken theme; lower the palette, not the floor.
 */
describe("mermaidThemeVariables", () => {
    const hex = (value: string | boolean) => String(value);

    for (const [name, theme] of Object.entries(THEMES)) {
        for (const mode of ["light", "dark"] as const) {
            const vars = mermaidThemeVariables(styleFor(theme[mode], mode));

            it(`keeps ${name} ${mode} node labels readable`, () => {
                expect(
                    contrastRatio(hex(vars.primaryTextColor), hex(vars.primaryColor)),
                ).toBeGreaterThanOrEqual(7);
                expect(
                    contrastRatio(hex(vars.textColor), hex(vars.background)),
                ).toBeGreaterThanOrEqual(7);
            });

            it(`keeps ${name} ${mode} edges and outlines visible`, () => {
                // WCAG 1.4.11: non-text content carrying meaning needs 3:1.
                expect(
                    contrastRatio(hex(vars.lineColor), hex(vars.background)),
                ).toBeGreaterThanOrEqual(3);
                expect(
                    contrastRatio(hex(vars.nodeBorder), hex(vars.primaryColor)),
                ).toBeGreaterThanOrEqual(3);
            });

            it(`keeps ${name} ${mode} sequence numbers readable`, () => {
                expect(
                    contrastRatio(hex(vars.sequenceNumberColor), hex(vars.lineColor)),
                ).toBeGreaterThanOrEqual(4.5);
            });
        }
    }

    it("tells mermaid which way to derive its own shades", () => {
        const palette = THEMES.obelisk!;
        expect(mermaidThemeVariables(styleFor(palette.dark, "dark")).darkMode).toBe(
            true,
        );
        expect(
            mermaidThemeVariables(styleFor(palette.light, "light")).darkMode,
        ).toBe(false);
    });
});

describe("sanitizeDiagram", () => {
    it("keeps the SVG mermaid produces, foreignObject labels included", () => {
        const svg = sanitizeDiagram(
            "<svg xmlns=\"http://www.w3.org/2000/svg\">" +
            "<foreignObject><div>label</div></foreignObject></svg>",
        );
        expect(svg).toContain("foreignObject");
        expect(svg).toContain("label");
    });

    it("drops a foreignObject that is not inside an SVG", () => {
        expect(sanitizeDiagram("<div><foreignObject>x</foreignObject></div>")).not.toContain(
            "foreignObject",
        );
    });

    it("strips script and event handlers", () => {
        const svg = sanitizeDiagram(
            "<svg onload=\"steal()\"><script>steal()</script></svg>",
        );
        expect(svg).not.toContain("script");
        expect(svg).not.toContain("onload");
    });
});

describe("diagramPreview", () => {
    const style = () => styleFor(THEMES.obelisk!.light, "light");

    it("declines every language but mermaid, so other blocks keep no preview", () => {
        const render = diagramPreview(style);
        expect(render("ts", "const a = 1", () => {})).toBeNull();
    });

    it("declines an empty diagram, so a just-opened fence stays editable", () => {
        const render = diagramPreview(style);
        expect(render("mermaid", "   \n ", () => {})).toBeNull();
    });

    it("promises a diagram asynchronously for a mermaid fence", () => {
        const render = diagramPreview(style);
        expect(render("mermaid", "graph TD; a-->b", () => {})).toBeUndefined();
    });
});

describe("pinSourceWhileEditing", () => {
    /** Two code blocks under one editor host, the way Crepe lays them out. */
    const editor = () => {
        const root = document.createElement("div");
        const blocks = [0, 1].map(() => {
            const block = document.createElement("div");
            block.className = "milkdown-code-block";
            const source = document.createElement("textarea");
            const button = document.createElement("button");
            block.append(source, button);
            root.append(block);
            return {block, source, button};
        });
        document.body.replaceChildren(root);
        return {root, blocks};
    };

    const focusIn = (el: Element) =>
        el.dispatchEvent(new FocusEvent("focusin", {bubbles: true}));
    const focusOut = (el: Element, next: Element | null) =>
        el.dispatchEvent(
            new FocusEvent("focusout", {bubbles: true, relatedTarget: next}),
        );

    it("marks the block the caret enters, and only that block", () => {
        const {root, blocks} = editor();
        const stop = pinSourceWhileEditing(root);

        focusIn(blocks[0]!.source);
        expect(blocks[0]!.block.classList.contains(EDITING_CLASS)).toBe(true);
        expect(blocks[1]!.block.classList.contains(EDITING_CLASS)).toBe(false);
        stop();
    });

    it("holds the mark while focus moves within the block", () => {
        const {root, blocks} = editor();
        const stop = pinSourceWhileEditing(root);
        const {block, source, button} = blocks[0]!;

        focusIn(source);
        focusOut(source, button);
        // This is the case that matters: were the mark dropped here, Crepe's
        // `.hidden` would win again and the source would vanish.
        expect(block.classList.contains(EDITING_CLASS)).toBe(true);
        stop();
    });

    it("clears the mark once focus leaves for good", () => {
        const {root, blocks} = editor();
        const stop = pinSourceWhileEditing(root);

        focusIn(blocks[0]!.source);
        focusOut(blocks[0]!.source, blocks[1]!.source);
        expect(blocks[0]!.block.classList.contains(EDITING_CLASS)).toBe(false);

        focusIn(blocks[1]!.source);
        focusOut(blocks[1]!.source, null);
        expect(blocks[1]!.block.classList.contains(EDITING_CLASS)).toBe(false);
        stop();
    });

    it("stops listening when torn down", () => {
        const {root, blocks} = editor();
        pinSourceWhileEditing(root)();

        focusIn(blocks[0]!.source);
        expect(blocks[0]!.block.classList.contains(EDITING_CLASS)).toBe(false);
    });
});

describe("the stashed source", () => {
    it("round-trips arrows and non-ASCII labels", () => {
        const source = "graph TD;\n  a-->|oui|b[\"café — 図\"]";
        expect(decodeSource(encodeSource(source))).toBe(source);
    });

    it("survives sanitisation, which the raw text does not", () => {
        // DOMPurify drops any attribute value containing `-->`, so a flowchart
        // stored verbatim would lose its source and never redraw on a theme
        // switch. This is the regression that made the encoding necessary.
        const source = "graph TD; a-->b";
        const attr = (value: string) =>
            sanitizeDiagram(`<div ${DIAGRAM_SOURCE_ATTR}="${value}"></div>`);

        expect(attr(source)).not.toContain(DIAGRAM_SOURCE_ATTR);
        expect(attr(encodeSource(source))).toContain(DIAGRAM_SOURCE_ATTR);
    });

    it("is discoverable from the DOM after Crepe serialises the preview", () => {
        // Crepe hands the preview through DOMPurify into `innerHTML`, so only
        // the markup survives — the class and source attribute are the whole
        // contract `retintDiagrams` relies on.
        const source = "graph TD; a-->b";
        const host = document.createElement("div");
        host.className = DIAGRAM_CLASS;
        host.setAttribute(DIAGRAM_SOURCE_ATTR, encodeSource(source));

        const panel = document.createElement("div");
        panel.innerHTML = sanitizeDiagram(host.outerHTML);

        const found = panel.querySelector<HTMLElement>(
            `.${DIAGRAM_CLASS}[${DIAGRAM_SOURCE_ATTR}]`,
        );
        expect(decodeSource(found?.getAttribute(DIAGRAM_SOURCE_ATTR) ?? "")).toBe(
            source,
        );
    });
});
