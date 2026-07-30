import {Plugin} from "@milkdown/kit/prose/state";
import {$nodeSchema, $prose, $remark} from "@milkdown/kit/utils";
import remarkFrontmatter from "remark-frontmatter";

/**
 * DESIGN §2.5. Without this, remark parses a leading `---` block as a thematic
 * break plus a heading, and autosave writes that mangling straight back to
 * disk. The node keeps the YAML as literal text so it round-trips byte for
 * byte, and renders as a native <details> so it collapses without any JS.
 */

// The "yaml" preset is required: $remark defaults missing options to `{}`,
// which remark-frontmatter reads as a matter config and rejects.
export const frontmatterRemark = $remark(
    "frontmatter",
    () => remarkFrontmatter,
    "yaml",
);

export const frontmatterSchema = $nodeSchema("frontmatter", () => ({
    content: "text*",
    group: "block",
    marks: "",
    code: true,
    defining: true,
    isolating: true,
    parseDOM: [
        {
            tag: "details[data-type=\"frontmatter\"]",
            preserveWhitespace: "full" as const,
        },
    ],
    toDOM: () => [
        "details",
        {"data-type": "frontmatter", class: "frontmatter"},
        ["summary", {contenteditable: "false"}, "frontmatter"],
        ["pre", ["code", {spellcheck: "false"}, 0]],
    ],
    parseMarkdown: {
        match: ({type}) => type === "yaml",
        runner: (state, node, proseType) => {
            state.openNode(proseType);
            if (typeof node.value === "string") state.addText(node.value);
            state.closeNode();
        },
    },
    toMarkdown: {
        match: (node) => node.type.name === "frontmatter",
        runner: (state, node) => {
            state.addNode("yaml", undefined, node.textContent);
        },
    },
}));

/**
 * The disclosure box, built and owned by hand (DESIGN §2.5).
 *
 * Neither the browser's own `<details>` toggle nor a ProseMirror click handler
 * is enough, and for the same underlying reason: opening the box sets the `open`
 * attribute *inside* the node's DOM, and ProseMirror's MutationObserver reads
 * any such mutation as the document having been edited behind its back. It
 * responds by redrawing the node from the document, which snaps the box shut in
 * the same tick it opened — so the click appears to do nothing at all.
 *
 * A node view is the only place `ignoreMutation` can be answered, which is what
 * makes the attribute survive.
 */
export function frontmatterDom(): {
    dom: HTMLDetailsElement;
    contentDOM: HTMLElement;
    summary: HTMLElement;
} {
    const dom = document.createElement("details");
    dom.dataset.type = "frontmatter";
    dom.className = "frontmatter";

    const summary = document.createElement("summary");
    // Set as an attribute, not the IDL property: this has to match what the
    // schema's `toDOM` emits so parsing and rendering agree on the same shape.
    summary.setAttribute("contenteditable", "false");
    summary.textContent = "frontmatter";

    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.spellcheck = false;
    pre.append(code);
    dom.append(summary, pre);

    // Cancelling the click also cancels any native toggle, so exactly one
    // happens whether or not the browser would have handled it itself.
    summary.addEventListener("click", (event) => {
        event.preventDefault();
        dom.open = !dom.open;
    });
    // ProseMirror would otherwise place a selection here and redraw.
    summary.addEventListener("mousedown", (event) => event.preventDefault());

    return {dom, contentDOM: code, summary};
}

/** True for the mutations the toggle itself causes, which must not trigger a redraw. */
export function isToggleMutation(
    mutation: MutationRecord | { type: string; target: Node },
    dom: Node,
): boolean {
    return mutation.type === "attributes" && mutation.target === dom;
}

export const frontmatterView = $prose(
    () =>
        new Plugin({
            props: {
                nodeViews: {
                    frontmatter: () => {
                        const {dom, contentDOM, summary} = frontmatterDom();
                        return {
                            dom,
                            contentDOM,
                            ignoreMutation: (mutation) =>
                                isToggleMutation(mutation, dom),
                            // The label is ours; the YAML below it is not.
                            stopEvent: (event) =>
                                event.target instanceof Node &&
                                summary.contains(event.target),
                        };
                    },
                },
            },
        }),
);
