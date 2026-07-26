import {$nodeSchema, $remark} from "@milkdown/kit/utils";
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
