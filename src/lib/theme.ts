import frameDark from "@milkdown/crepe/theme/frame-dark.css?url";
import frameLight from "@milkdown/crepe/theme/frame.css?url";
import type {Appearance} from "./appSettings";
import type {Palette} from "./editorSettings";

export type Theme = "light" | "dark";

/**
 * Generated CSS goes into a `<style>` element rather than inline styles because
 * it has to reach nodes ProseMirror creates and destroys as you type, and — for
 * the palette — the `:root` variables the whole app is written against.
 */
export function injectStyle(id: string, css: string): void {
    let element = document.getElementById(id);
    if (!element) {
        element = document.createElement("style");
        element.id = id;
        document.head.appendChild(element);
    }
    if (element.textContent !== css) element.textContent = css;
}

export function systemTheme(): Theme {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
}

export function resolveTheme(appearance: Appearance): Theme {
    return appearance === "system" ? systemTheme() : appearance;
}

/**
 * Crepe ships light and dark as separate stylesheets that both define the same
 * variables, so they can't both be bundled — whichever loads last would always
 * win. Swap the href on a single <link> instead.
 */
export function applyTheme(theme: Theme): void {
    document.documentElement.dataset.theme = theme;

    let link = document.getElementById("crepe-theme") as HTMLLinkElement | null;
    if (!link) {
        link = document.createElement("link");
        link.id = "crepe-theme";
        link.rel = "stylesheet";
        document.head.appendChild(link);
    }
    const href = theme === "dark" ? frameDark : frameLight;
    if (link.getAttribute("href") !== href) link.setAttribute("href", href);
}

export function watchSystemTheme(onChange: () => void): () => void {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return () => {
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
}

/**
 * xterm's stock ANSI palette assumes a dark background; on white, its yellow
 * and cyan are close to invisible. Each mode gets a palette tuned for its
 * background rather than sharing one.
 *
 * `palette` overlays the theme's own ground, foreground and cursor so the
 * terminal belongs to the active theme. The sixteen ANSI colours stay keyed to
 * light/dark only: programs assign them meanings (red is an error, green a pass),
 * so re-tinting them per theme would trade a real signal for a cosmetic one —
 * and hand-tuning sixteen colours across twelve palettes would rot immediately.
 */
export function xtermTheme(theme: Theme, palette?: Palette) {
    const base = ansiPalette(theme);
    if (!palette) return base;
    return {
        ...base,
        background: palette.termBg,
        foreground: palette.fg,
        cursor: palette.fg,
        cursorAccent: palette.termBg,
        selectionBackground: palette.borderStrong,
    };
}

function ansiPalette(theme: Theme) {
    return theme === "dark"
        ? {
            background: "#1e2128",
            foreground: "#e4e6eb",
            cursor: "#e4e6eb",
            cursorAccent: "#1e2128",
            selectionBackground: "#3a4050",
            black: "#3b4048",
            red: "#e06c75",
            green: "#98c379",
            yellow: "#e5c07b",
            blue: "#61afef",
            magenta: "#c678dd",
            cyan: "#56b6c2",
            white: "#dcdfe4",
            brightBlack: "#4f5666",
            brightRed: "#ef7a85",
            brightGreen: "#a9d47f",
            brightYellow: "#f0d194",
            brightBlue: "#74b6f0",
            brightMagenta: "#d193e6",
            brightCyan: "#6bc3cf",
            brightWhite: "#ffffff",
        }
        : {
            background: "#ffffff",
            foreground: "#1f2328",
            cursor: "#1f2328",
            cursorAccent: "#ffffff",
            selectionBackground: "#cfe3ff",
            black: "#24292f",
            red: "#cf222e",
            green: "#116329",
            yellow: "#4d2d00",
            blue: "#0969da",
            magenta: "#8250df",
            cyan: "#1b7c83",
            white: "#6e7781",
            brightBlack: "#57606a",
            brightRed: "#a40e26",
            brightGreen: "#1a7f37",
            brightYellow: "#633c01",
            brightBlue: "#218bff",
            brightMagenta: "#a475f9",
            brightCyan: "#3192aa",
            brightWhite: "#8c959f",
        };
}
