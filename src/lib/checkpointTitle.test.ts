import { describe, expect, it } from "vitest";
import {
  checkpointTitle,
  nearestHeading,
  parseDiff,
} from "./checkpointTitle";

const DIFF = `diff --git a/notes.md b/notes.md
index 1234567..89abcde 100644
--- a/notes.md
+++ b/notes.md
@@ -12,3 +12,5 @@ context
 unchanged
-gone
+added one
+added two
`;

describe("parseDiff", () => {
  it("counts changed lines and finds the first hunk", () => {
    expect(parseDiff(DIFF)).toEqual({
      added: 2,
      removed: 1,
      firstLine: 12,
    });
  });

  it("ignores the +++/--- file headers", () => {
    const { added, removed } = parseDiff(DIFF);
    expect(added).toBe(2);
    expect(removed).toBe(1);
  });

  it("reports nothing for an empty diff", () => {
    expect(parseDiff("")).toEqual({ added: 0, removed: 0, firstLine: null });
  });

  it("keeps the first hunk when several are present", () => {
    const multi = `@@ -1,2 +3,4 @@\n+a\n@@ -20,2 +40,2 @@\n+b\n`;
    expect(parseDiff(multi).firstLine).toBe(3);
  });
});

describe("nearestHeading", () => {
  const doc = [
    "# Title", // 1
    "", // 2
    "intro", // 3
    "", // 4
    "## Installation", // 5
    "", // 6
    "run it", // 7
    "", // 8
    "## Usage", // 9
    "", // 10
    "use it", // 11
  ].join("\n");

  it("finds the closest heading above the line", () => {
    expect(nearestHeading(doc, 7)).toBe("Installation");
    expect(nearestHeading(doc, 11)).toBe("Usage");
    expect(nearestHeading(doc, 3)).toBe("Title");
  });

  it("returns null when nothing precedes the line", () => {
    expect(nearestHeading("no headings here\nat all\n", 2)).toBeNull();
  });

  it("ignores comments inside fenced code blocks", () => {
    const fenced = [
      "## Real Heading", // 1
      "", // 2
      "```bash", // 3
      "# not a heading", // 4
      "```", // 5
      "", // 6
      "text", // 7
    ].join("\n");
    expect(nearestHeading(fenced, 7)).toBe("Real Heading");
  });

  it("strips closing hashes from closed ATX headings", () => {
    expect(nearestHeading("### Middle ###\ntext", 2)).toBe("Middle");
  });
});

describe("checkpointTitle", () => {
  const content = ["# Doc", "", "## Installation", "", "steps", ""].join("\n");

  it("names the section containing the change", () => {
    expect(
      checkpointTitle({
        fileName: "README.md",
        content,
        diff: "@@ -5,1 +5,2 @@\n+a\n+b\n-c\n",
        tracked: true,
      }),
    ).toBe("Edit 'Installation' in README.md (+2/−1)");
  });

  it("falls back to the filename when no heading applies", () => {
    expect(
      checkpointTitle({
        fileName: "notes.md",
        content: "just a paragraph\n",
        diff: "@@ -1,1 +1,2 @@\n+more\n",
        tracked: true,
      }),
    ).toBe("Edit notes.md (+1/−0)");
  });

  it("labels a file that has never been checkpointed", () => {
    expect(
      checkpointTitle({
        fileName: "new.md",
        content: "# New\n",
        diff: "",
        tracked: false,
      }),
    ).toBe("Add new.md");
  });
});
