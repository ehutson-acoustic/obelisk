/**
 * Markdown-aware checkpoint titles (DESIGN §3.3). Headings are the natural
 * section labels in a document, so naming the one above the first changed hunk
 * says more than a bare filename ever could — and it costs nothing.
 */

export type TitleInput = {
    fileName: string;
    /** Current buffer, used to locate the heading above the change. */
    content: string;
    /** Unified diff against the last checkpoint; empty for a new file. */
    diff: string;
    tracked: boolean;
};

type DiffStats = { added: number; removed: number; firstLine: number | null };

export function parseDiff(diff: string): DiffStats {
    let added = 0;
    let removed = 0;
    let firstLine: number | null = null;

    for (const line of diff.split("\n")) {
        const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
        if (hunk) {
            firstLine ??= Number(hunk[1]);
            continue;
        }
        if (line.startsWith("+++") || line.startsWith("---")) continue;
        if (line.startsWith("+")) added++;
        else if (line.startsWith("-")) removed++;
    }

    return {added, removed, firstLine};
}

/**
 * Nearest ATX heading at or above `line` (1-based). Scans forward tracking
 * fence state rather than walking backwards, so a `# comment` inside a code
 * block isn't mistaken for a heading.
 */
export function nearestHeading(content: string, line: number): string | null {
    const lines = content.split("\n");
    let inFence = false;
    let heading: string | null = null;

    for (let i = 0; i < Math.min(line, lines.length); i++) {
        const text = lines[i];
        if (/^\s{0,3}(```|~~~)/.test(text)) {
            inFence = !inFence;
            continue;
        }
        if (inFence) continue;
        const match = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(text);
        if (match) heading = match[1].trim();
    }

    return heading;
}

export function checkpointTitle({
                                    fileName,
                                    content,
                                    diff,
                                    tracked,
                                }: TitleInput): string {
    if (!tracked) return `Add ${fileName}`;

    const {added, removed, firstLine} = parseDiff(diff);
    const stats = `(+${added}/−${removed})`;
    const heading =
        firstLine === null ? null : nearestHeading(content, firstLine);

    return heading
        ? `Edit '${heading}' in ${fileName} ${stats}`
        : `Edit ${fileName} ${stats}`;
}
