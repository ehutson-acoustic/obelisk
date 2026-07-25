import { describe, expect, it } from "vitest";
import { luminance, parseHex, readableFg } from "./contrast";

describe("parseHex", () => {
  it("handles long, short, and prefixed forms", () => {
    expect(parseHex("#ffffff")).toEqual([255, 255, 255]);
    expect(parseHex("000")).toEqual([0, 0, 0]);
    expect(parseHex("#F00")).toEqual([255, 0, 0]);
  });

  it("rejects garbage", () => {
    expect(parseHex("nope")).toBeNull();
    expect(parseHex("#12345")).toBeNull();
  });
});

describe("luminance", () => {
  it("anchors at the extremes", () => {
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#ffffff")).toBeCloseTo(1, 5);
  });
});

describe("readableFg", () => {
  it("picks dark text on light backgrounds and vice versa", () => {
    expect(readableFg("#ffffff")).toBe("#14161a");
    expect(readableFg("#000000")).toBe("#f5f7fa");
  });

  it("handles the default project swatches", () => {
    // All ship as dark colors, so every one should take light text.
    for (const c of ["#2f6f4e", "#1f4e79", "#6b3fa0", "#a03f3f", "#43474e"]) {
      expect(readableFg(c)).toBe("#f5f7fa");
    }
    // Yellow is the classic trap: light enough that white text fails.
    expect(readableFg("#ffe066")).toBe("#14161a");
  });

  it("falls back to dark text rather than throwing on bad input", () => {
    expect(readableFg("not-a-color")).toBe("#14161a");
  });
});
