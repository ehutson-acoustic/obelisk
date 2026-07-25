// @vitest-environment jsdom
import { Crepe } from "@milkdown/crepe";
import { editorViewCtx } from "@milkdown/kit/core";
import type { Ctx } from "@milkdown/kit/ctx";
import { TextSelection } from "@milkdown/kit/prose/state";
import { beforeAll, describe, expect, it } from "vitest";
import { buildToolbar } from "./toolbar";

type Item = {
  key: string;
  icon: string;
  active: (ctx: Ctx) => boolean;
  onRun?: (ctx: Ctx) => void;
};

/** Run buildToolbar against a recording stand-in for Crepe's GroupBuilder. */
function collect() {
  const groups: { key: string; items: Item[] }[] = [];
  const builder = {
    clear() {
      groups.length = 0;
      return this;
    },
    addGroup(key: string) {
      const group = { key, items: [] as Item[] };
      groups.push(group);
      const api = {
        group,
        addItem(k: string, item: Omit<Item, "key">) {
          group.items.push({ key: k, ...item });
          return api;
        },
        clear() {
          group.items.length = 0;
          return api;
        },
      };
      return api;
    },
    build: () => groups,
  };
  buildToolbar(builder as never);
  return groups;
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
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

async function withEditor(
  text: string,
  run: (ctx: Ctx) => void,
): Promise<string> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const crepe = new Crepe({
    root,
    defaultValue: text,
    features: {
      [Crepe.Feature.TopBar]: false,
      [Crepe.Feature.BlockEdit]: false,
      [Crepe.Feature.ImageBlock]: false,
      [Crepe.Feature.Latex]: false,
      [Crepe.Feature.AI]: false,
      [Crepe.Feature.CodeMirror]: false,
    },
  });
  await crepe.create();
  crepe.editor.action((ctx) => {
    // Select the whole first paragraph before invoking the toolbar action.
    const view = ctx.get(editorViewCtx);
    const end = view.state.doc.firstChild?.content.size ?? 0;
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, end + 1)),
    );
  });
  crepe.editor.action(run);
  const out = crepe.getMarkdown();
  await crepe.destroy();
  root.remove();
  return out;
}

const items = new Map(
  collect().flatMap((g) => g.items.map((i) => [i.key, i] as const)),
);

const run = (key: string) => (ctx: Ctx) => {
  const item = items.get(key);
  if (!item?.onRun) throw new Error(`no such toolbar item: ${key}`);
  item.onRun(ctx);
};

describe("toolbar contents", () => {
  it("exposes exactly the nine actions in the spec, in order", () => {
    expect([...items.keys()]).toEqual([
      "bold",
      "italic",
      "heading",
      "link",
      "code-block",
      "bullet-list",
      "ordered-list",
      "task-list",
      "blockquote",
    ]);
  });

  it("gives every item an icon", () => {
    for (const item of items.values()) {
      expect(item.icon).toContain("<svg");
    }
  });
});

describe("toolbar actions", () => {
  it("bold wraps the selection", async () => {
    expect(await withEditor("hello world", run("bold"))).toContain(
      "**hello world**",
    );
  });

  it("italic wraps the selection", async () => {
    expect(await withEditor("hello world", run("italic"))).toContain(
      "*hello world*",
    );
  });

  it("heading cycles paragraph into h1", async () => {
    expect(await withEditor("hello world", run("heading"))).toContain(
      "# hello world",
    );
  });

  it("heading cycles h2 into h3", async () => {
    expect(await withEditor("## hello world", run("heading"))).toContain(
      "### hello world",
    );
  });

  it("heading cycles h3 back to a paragraph", async () => {
    const out = await withEditor("### hello world", run("heading"));
    expect(out.trim()).toBe("hello world");
  });

  it("code-block converts the paragraph", async () => {
    expect(await withEditor("hello world", run("code-block"))).toContain("```");
  });

  it("bullet-list wraps the paragraph", async () => {
    expect(await withEditor("hello world", run("bullet-list"))).toContain(
      "* hello world",
    );
  });

  it("ordered-list wraps the paragraph", async () => {
    expect(await withEditor("hello world", run("ordered-list"))).toContain(
      "1. hello world",
    );
  });

  it("task-list produces an unchecked checkbox", async () => {
    expect(await withEditor("hello world", run("task-list"))).toContain(
      "[ ] hello world",
    );
  });

  it("blockquote wraps the paragraph", async () => {
    expect(await withEditor("hello world", run("blockquote"))).toContain(
      "> hello world",
    );
  });
});
