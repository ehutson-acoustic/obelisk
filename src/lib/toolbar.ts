import type {ToolbarFeatureConfig} from "@milkdown/crepe/feature/toolbar";
import {toggleLinkCommand} from "@milkdown/kit/component/link-tooltip";
import {commandsCtx, editorViewCtx} from "@milkdown/kit/core";
import type {Ctx} from "@milkdown/kit/ctx";
import {
    blockquoteSchema,
    bulletListSchema,
    codeBlockSchema,
    emphasisSchema,
    headingSchema,
    isMarkSelectedCommand,
    linkSchema,
    listItemSchema,
    orderedListSchema,
    paragraphSchema,
    setBlockTypeCommand,
    strongSchema,
    toggleEmphasisCommand,
    toggleStrongCommand,
    wrapInBlockTypeCommand,
} from "@milkdown/kit/preset/commonmark";
import type {NodeType} from "@milkdown/kit/prose/model";

/**
 * The spec calls for exactly nine formatting actions in the selection popup.
 * Crepe's default set is different (it has strikethrough and inline code, and
 * no block actions), so clear the builder and declare our own.
 */

const svg = (paths: string) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${paths}</svg>`;

const stroke = (d: string) =>
    svg(
        `<path d="${d}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    );

const icons = {
    bold: stroke("M6 4h8a4 4 0 0 1 0 8H6z M6 12h9a4 4 0 0 1 0 8H6z"),
    italic: stroke("M19 4h-9 M14 20H5 M15 4L9 20"),
    heading: stroke("M6 4v16 M18 4v16 M6 12h12"),
    link: stroke(
        "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71 M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
    ),
    codeBlock: stroke(
        "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M10 9.5 8 12l2 2.5 M14 9.5l2 2.5-2 2.5",
    ),
    bulletList: stroke(
        "M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01",
    ),
    orderedList: stroke(
        "M10 6h11 M10 12h11 M10 18h11 M4 4h1v5 M4 9h2 M6 19H4c0-1.2 2-1.8 2-3 0-.7-.6-1.2-2-1",
    ),
    taskList: stroke("m3 7 2 2 4-4 M3 17l2 2 4-4 M13 8h8 M13 18h8"),
    blockquote: stroke(
        "M10 11H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 2-1 3-3 3 M19 11h-4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v6c0 2-1 3-3 3",
    ),
};

/** True when any ancestor of the cursor is of the given node type. */
function inNode(ctx: Ctx, type: NodeType): boolean {
    const {$from} = ctx.get(editorViewCtx).state.selection;
    for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type === type) return true;
    }
    return false;
}

function headingLevel(ctx: Ctx): number {
    const heading = headingSchema.type(ctx);
    const {$from} = ctx.get(editorViewCtx).state.selection;
    for (let d = $from.depth; d > 0; d--) {
        const node = $from.node(d);
        if (node.type === heading) return Number(node.attrs.level) || 0;
    }
    return 0;
}

type BuildToolbar = NonNullable<ToolbarFeatureConfig["buildToolbar"]>;

export const buildToolbar: BuildToolbar = (builder) => {
    // buildToolbar runs after Crepe has added its defaults, so start clean.
    builder.clear();

    const inline = builder.addGroup("inline", "Inline");

    inline.addItem("bold", {
        icon: icons.bold,
        active: (ctx) =>
            ctx
                .get(commandsCtx)
                .call(isMarkSelectedCommand.key, strongSchema.type(ctx)),
        onRun: (ctx) => ctx.get(commandsCtx).call(toggleStrongCommand.key),
    });

    inline.addItem("italic", {
        icon: icons.italic,
        active: (ctx) =>
            ctx
                .get(commandsCtx)
                .call(isMarkSelectedCommand.key, emphasisSchema.type(ctx)),
        onRun: (ctx) => ctx.get(commandsCtx).call(toggleEmphasisCommand.key),
    });

    // One button cycling H1 → H2 → H3 → paragraph, since the spec asks for a
    // single "header" action rather than one per level.
    inline.addItem("heading", {
        icon: icons.heading,
        active: (ctx) => headingLevel(ctx) > 0,
        onRun: (ctx) => {
            const commands = ctx.get(commandsCtx);
            const next = headingLevel(ctx) >= 3 ? 0 : headingLevel(ctx) + 1;
            if (next === 0) {
                commands.call(setBlockTypeCommand.key, {
                    nodeType: paragraphSchema.type(ctx),
                });
            } else {
                commands.call(setBlockTypeCommand.key, {
                    nodeType: headingSchema.type(ctx),
                    attrs: {level: next},
                });
            }
        },
    });

    inline.addItem("link", {
        icon: icons.link,
        active: (ctx) =>
            ctx.get(commandsCtx).call(isMarkSelectedCommand.key, linkSchema.type(ctx)),
        onRun: (ctx) => ctx.get(commandsCtx).call(toggleLinkCommand.key),
    });

    const block = builder.addGroup("block", "Block");

    block.addItem("code-block", {
        icon: icons.codeBlock,
        active: (ctx) => inNode(ctx, codeBlockSchema.type(ctx)),
        onRun: (ctx) =>
            ctx.get(commandsCtx).call(setBlockTypeCommand.key, {
                nodeType: codeBlockSchema.type(ctx),
            }),
    });

    block.addItem("bullet-list", {
        icon: icons.bulletList,
        active: (ctx) => inNode(ctx, bulletListSchema.type(ctx)),
        onRun: (ctx) =>
            ctx.get(commandsCtx).call(wrapInBlockTypeCommand.key, {
                nodeType: bulletListSchema.type(ctx),
            }),
    });

    block.addItem("ordered-list", {
        icon: icons.orderedList,
        active: (ctx) => inNode(ctx, orderedListSchema.type(ctx)),
        onRun: (ctx) =>
            ctx.get(commandsCtx).call(wrapInBlockTypeCommand.key, {
                nodeType: orderedListSchema.type(ctx),
            }),
    });

    // GFM task lists are list items carrying a `checked` attribute, so there is
    // no dedicated command — mirror what Crepe's own slash menu does.
    block.addItem("task-list", {
        icon: icons.taskList,
        active: (ctx) => {
            const {$from} = ctx.get(editorViewCtx).state.selection;
            const listItem = listItemSchema.type(ctx);
            for (let d = $from.depth; d > 0; d--) {
                const node = $from.node(d);
                if (node.type === listItem && node.attrs.checked !== null) return true;
            }
            return false;
        },
        onRun: (ctx) =>
            ctx.get(commandsCtx).call(wrapInBlockTypeCommand.key, {
                nodeType: listItemSchema.type(ctx),
                attrs: {checked: false},
            }),
    });

    block.addItem("blockquote", {
        icon: icons.blockquote,
        active: (ctx) => inNode(ctx, blockquoteSchema.type(ctx)),
        onRun: (ctx) =>
            ctx.get(commandsCtx).call(wrapInBlockTypeCommand.key, {
                nodeType: blockquoteSchema.type(ctx),
            }),
    });
};
