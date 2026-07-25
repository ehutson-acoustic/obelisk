// @vitest-environment jsdom
import { Crepe } from "@milkdown/crepe";
import { beforeAll, describe, expect, it } from "vitest";
import { frontmatterRemark, frontmatterSchema } from "./frontmatter";

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
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  globalThis.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
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
