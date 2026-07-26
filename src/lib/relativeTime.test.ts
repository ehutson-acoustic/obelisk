import {describe, expect, it} from "vitest";
import {formatRelative} from "./relativeTime";

// Fixed "now" so the tests don't drift.
const NOW = Date.UTC(2026, 6, 25, 12, 0, 0);
const ago = (seconds: number) => Math.floor(NOW / 1000) - seconds;

describe("formatRelative", () => {
    it("collapses anything very recent", () => {
        expect(formatRelative(ago(0), NOW)).toBe("just now");
        expect(formatRelative(ago(44), NOW)).toBe("just now");
    });

    it("counts minutes, hours and days", () => {
        expect(formatRelative(ago(60), NOW)).toBe("1m ago");
        expect(formatRelative(ago(59 * 60), NOW)).toBe("59m ago");
        expect(formatRelative(ago(4 * 3600), NOW)).toBe("4h ago");
        expect(formatRelative(ago(23 * 3600), NOW)).toBe("23h ago");
        expect(formatRelative(ago(3 * 86400), NOW)).toBe("3d ago");
    });

    it("steps up to weeks, months and years", () => {
        expect(formatRelative(ago(10 * 86400), NOW)).toBe("1w ago");
        expect(formatRelative(ago(60 * 86400), NOW)).toBe("2mo ago");
        expect(formatRelative(ago(400 * 86400), NOW)).toBe("1y ago");
    });

    it("never rounds a just-passed minute down to 0m", () => {
        expect(formatRelative(ago(45), NOW)).toBe("1m ago");
    });

    it("treats clock skew as the present rather than the future", () => {
        expect(formatRelative(ago(-500), NOW)).toBe("just now");
    });
});
