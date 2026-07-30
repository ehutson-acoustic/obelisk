// @vitest-environment jsdom
import {Crepe} from "@milkdown/crepe";
import {beforeAll, describe, expect, it} from "vitest";
import {
    frontmatterDom,
    frontmatterRemark,
    frontmatterSchema,
    isToggleMutation,
} from "./frontmatter";

const WITH_FRONTMATTER = `---
title: Test Note
tags:
  - alpha
  - beta
draft: true
---

# Heading

Body text.
`;

beforeAll(() => {
    // ProseMirror/Crepe touch a few browser APIs jsdom doesn't implement.
    globalThis.ResizeObserver ??= class {
        observe() {
        }

        unobserve() {
        }

        disconnect() {
        }
    } as never;
    globalThis.matchMedia ??= ((q: string) => ({
        matches: false,
        media: q,
        addEventListener() {
        },
        removeEventListener() {
        },
    })) as never;
    Range.prototype.getBoundingClientRect ??= (() => ({
        top: 0,
        left: 0,
        bottom: 0,
        right: 0,
        width: 0,
        height: 0,
    })) as never;
    Range.prototype.getClientRects ??= (() => []) as never;
});

async function roundTrip(markdown: string, withPlugin: boolean) {
    const root = document.createElement("div");
    document.body.appendChild(root);
    const crepe = new Crepe({
        root,
        defaultValue: markdown,
        features: {
            [Crepe.Feature.TopBar]: false,
            [Crepe.Feature.BlockEdit]: false,
            [Crepe.Feature.ImageBlock]: false,
            [Crepe.Feature.Latex]: false,
            [Crepe.Feature.AI]: false,
            [Crepe.Feature.Toolbar]: false,
            [Crepe.Feature.Placeholder]: false,
            [Crepe.Feature.CodeMirror]: false,
        },
    });
    if (withPlugin) {
        crepe.addFeature((editor) => {
            editor.use(frontmatterRemark).use(frontmatterSchema);
        });
    }
    await crepe.create();
    const out = crepe.getMarkdown();
    await crepe.destroy();
    root.remove();
    return out;
}

describe("frontmatter round-trip", () => {
    it("preserves YAML frontmatter exactly", async () => {
        const out = await roundTrip(WITH_FRONTMATTER, true);
        expect(out).toBe(WITH_FRONTMATTER);
    });

    it("would corrupt it without the plugin (guards against silent regression)", async () => {
        const out = await roundTrip(WITH_FRONTMATTER, false);
        expect(out).not.toBe(WITH_FRONTMATTER);
        // The block stops being frontmatter at all: `---` degrades to a thematic
        // break and the YAML body is re-emitted as paragraphs and bullet lists.
        expect(out.startsWith("---")).toBe(false);
        expect(out).toContain("***");
    });

    it("leaves documents without frontmatter untouched", async () => {
        const plain = "# Just a heading\n\nAnd a paragraph.\n";
        expect(await roundTrip(plain, true)).toBe(plain);
    });
});

/**
 * The box shipped shut twice: once because WebKit will not toggle a `<details>`
 * inside `contenteditable`, and again because ProseMirror's MutationObserver
 * reverted the `open` attribute as soon as it was set. Both failures looked
 * identical from the outside — a click that did nothing — so the toggle is
 * pinned here rather than left to inspection.
 */
describe("frontmatter disclosure", () => {
    it("starts closed and opens on a summary click", () => {
        const {dom, summary} = frontmatterDom();
        expect(dom.open).toBe(false);

        summary.dispatchEvent(new MouseEvent("click", {bubbles: true, cancelable: true}));
        expect(dom.open).toBe(true);
    });

    it("closes again on a second click", () => {
        const {dom, summary} = frontmatterDom();
        for (const expected of [true, false, true]) {
            summary.dispatchEvent(
                new MouseEvent("click", {bubbles: true, cancelable: true}),
            );
            expect(dom.open).toBe(expected);
        }
    });

    it("cancels the click so a native toggle cannot double-fire it", () => {
        const {summary} = frontmatterDom();
        const event = new MouseEvent("click", {bubbles: true, cancelable: true});
        summary.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
    });

    it("exposes the code element as the editable content hole", () => {
        const {dom, contentDOM} = frontmatterDom();
        expect(contentDOM.tagName).toBe("CODE");
        expect(contentDOM.closest("details")).toBe(dom);
        // The label must not be editable, or the caret lands in it.
        expect(dom.querySelector("summary")?.getAttribute("contenteditable")).toBe(
            "false",
        );
    });

    it("tells ProseMirror to ignore the attribute change the toggle causes", () => {
        const {dom, contentDOM} = frontmatterDom();
        // What setting `open` produces, and what used to trigger the redraw that
        // snapped the box shut.
        expect(isToggleMutation({type: "attributes", target: dom}, dom)).toBe(true);
        // A real edit to the YAML must still reach ProseMirror.
        expect(
            isToggleMutation({type: "characterData", target: contentDOM}, dom),
        ).toBe(false);
        expect(isToggleMutation({type: "childList", target: dom}, dom)).toBe(false);
    });
});
