/**
 * Project cards use their configured color as the full card background, so the
 * title has to stay readable against whatever the user picks. Derive the
 * foreground from WCAG relative luminance rather than hardcoding it.
 */

export function parseHex(hex: string): [number, number, number] | null {
    let h = hex.trim().replace(/^#/, "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return [
        Number.parseInt(h.slice(0, 2), 16),
        Number.parseInt(h.slice(2, 4), 16),
        Number.parseInt(h.slice(4, 6), 16),
    ];
}

/** WCAG 2.x relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
    const rgb = parseHex(hex);
    if (!rgb) return 1;
    const [r, g, b] = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * 0.179 is the luminance at which contrast against black and against white are
 * equal, so it maximizes contrast for any background.
 */
export function readableFg(hex: string): string {
    return luminance(hex) > 0.179 ? "#14161a" : "#f5f7fa";
}
