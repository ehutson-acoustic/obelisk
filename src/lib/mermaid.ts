import DOMPurify from "dompurify";
import {readableFg} from "./contrast";
import type {Palette} from "./editorSettings";
import type {Theme} from "./theme";

/**
 * DESIGN §2.6. A ```mermaid fence stays an ordinary code block; the diagram is
 * drawn into the *preview* panel Crepe's code-block component already provides
 * for every language. Nothing about the document model changes, so a diagram
 * round-trips as the literal fence it was typed as.
 */

export const MERMAID_LANGUAGE = "mermaid";

/** The class and attribute the retint pass finds a drawn diagram by. */
export const DIAGRAM_CLASS = "mermaid-diagram";
export const DIAGRAM_SOURCE_ATTR = "data-mermaid-source";
export const DIAGRAM_ERROR_ATTR = "data-mermaid-error";

/**
 * The stashed source is base64, not the diagram text.
 *
 * DOMPurify drops any attribute whose value contains `-->`, as a defence
 * against mXSS through a mis-parsed comment — and `-->` is the arrow in almost
 * every flowchart ever written, so the plain text would survive sanitisation
 * only for diagrams that happen not to draw an edge. Base64 also keeps
 * non-ASCII labels intact, which is why it goes through TextEncoder rather
 * than `btoa` alone.
 */
export function encodeSource(source: string): string {
    const bytes = new TextEncoder().encode(source);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
}

export function decodeSource(encoded: string): string {
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

/** GitHub honours exactly one spelling, so this does too. */
export function isMermaid(language: string | null | undefined): boolean {
    return (language ?? "").trim().toLowerCase() === MERMAID_LANGUAGE;
}

/** Everything mermaid needs from the app's theme, resolved at render time. */
export type DiagramStyle = {
    theme: Theme;
    palette: Palette;
    /** The resolved `body` component's family and size, so labels match the prose. */
    fontFamily: string;
    fontSize: string;
};

/**
 * The active palette, expressed as mermaid theme variables.
 *
 * Mermaid's own `default` and `dark` themes carry a fixed lavender palette that
 * would fight eleven of the twelve themes, so diagrams are drawn on the `base`
 * theme with these substituted in. Only the roots are set — mermaid derives the
 * rest from them, and overriding its derivations wholesale is how a palette
 * ends up internally inconsistent.
 *
 * Node outlines and edges take `fgMuted` rather than either border colour: the
 * chrome borders are deliberately faint (~1.5:1), which is right for a panel
 * edge and unreadable for the line that *is* the content. `mermaid.test.ts`
 * holds these pairings to the same contrast floors as the palettes themselves.
 */
export function mermaidThemeVariables(
    style: DiagramStyle,
): Record<string, string | boolean> {
    const p = style.palette;
    return {
        darkMode: style.theme === "dark",
        fontFamily: style.fontFamily,
        fontSize: style.fontSize,

        // The canvas is the code block's own surface; nodes sit on it as the
        // page background, which reads as raised in light themes and recessed
        // in dark ones — either way, as a distinct object.
        background: p.bgSunken,
        primaryColor: p.bg,
        mainBkg: p.bg,
        primaryTextColor: p.fg,
        primaryBorderColor: p.fgMuted,
        secondaryColor: p.bgRaised,
        secondaryTextColor: p.fg,
        secondaryBorderColor: p.fgMuted,
        tertiaryColor: p.bgSunken,
        tertiaryTextColor: p.fg,
        tertiaryBorderColor: p.fgMuted,

        nodeBorder: p.fgMuted,
        nodeTextColor: p.fg,
        clusterBkg: p.bgRaised,
        clusterBorder: p.fgMuted,
        lineColor: p.fgMuted,
        textColor: p.fg,
        titleColor: p.fg,
        edgeLabelBackground: p.bgSunken,

        // Notes are the one place mermaid hard-codes a yellow rather than
        // deriving it, so they have to be named explicitly.
        noteBkgColor: p.bgRaised,
        noteTextColor: p.fg,
        noteBorderColor: p.fgMuted,

        // Sequence diagrams keep a parallel set of names for the same roles.
        actorBkg: p.bg,
        actorBorder: p.fgMuted,
        actorTextColor: p.fg,
        actorLineColor: p.fgMuted,
        signalColor: p.fg,
        signalTextColor: p.fg,
        labelBoxBkgColor: p.bg,
        labelBoxBorderColor: p.fgMuted,
        labelTextColor: p.fg,
        loopTextColor: p.fg,
        activationBkgColor: p.bgRaised,
        activationBorderColor: p.fgMuted,
        // The sequence number is drawn inside a circle filled with `lineColor`.
        sequenceNumberColor: readableFg(p.fgMuted),

        errorBkgColor: p.bannerBg,
        errorTextColor: p.danger,
    };
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * Mermaid v11 draws flowchart labels in `<foreignObject>`, which DOMPurify
 * strips by default — outside an `<svg>` it is a known mXSS vector
 * (CVE-2020-26870). Allow the tag, then drop any instance whose parent is not
 * in the SVG namespace.
 *
 * Milkdown's preview panel makes exactly this trade for the content it injects;
 * it is repeated here because the theme re-render (`retintDiagrams`) writes
 * into the DOM directly and so never passes through it.
 */
function createSanitizer() {
    const purify = DOMPurify();
    purify.addHook("uponSanitizeElement", (node, data) => {
        if (data.tagName !== "foreignobject") return;
        const parent = node.parentElement;
        if (parent?.namespaceURI !== SVG_NAMESPACE) {
            node.parentNode?.removeChild(node);
        }
    });
    return (dirty: string) =>
        purify.sanitize(dirty, {
            ADD_TAGS: ["foreignObject"],
            ADD_ATTR: ["xmlns"],
            HTML_INTEGRATION_POINTS: {foreignobject: true},
        });
}

let sanitizer: ReturnType<typeof createSanitizer> | undefined;

export function sanitizeDiagram(svg: string): string {
    sanitizer ??= createSanitizer();
    return sanitizer(svg);
}

/**
 * mermaid is around a megabyte once its layout engines are counted, and most
 * documents contain no diagrams at all, so it is only fetched the first time
 * one is drawn.
 */
let loading: Promise<typeof import("mermaid")> | null = null;

function loadMermaid() {
    // Cleared on failure so a chunk that failed to fetch is retried on the next
    // diagram, rather than every diagram for the rest of the session inheriting
    // one rejected promise.
    loading ??= import("mermaid").catch((error: unknown) => {
        loading = null;
        throw error;
    });
    return loading;
}

let sequence = 0;

async function renderDiagram(
    source: string,
    style: DiagramStyle,
): Promise<string> {
    const {default: mermaid} = await loadMermaid();
    // `initialize` writes module-global config that `render` reads back across
    // its own awaits, which is why renders are serialised (see `enqueue`) —
    // two in flight at once can each finish under the other's theme.
    mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        // Mermaid's own failure card is an SVG it appends to the document and
        // leaves there. The message comes back on the thrown error instead.
        suppressErrorRendering: true,
        theme: "base",
        themeVariables: mermaidThemeVariables(style),
        fontFamily: style.fontFamily,
    });
    sequence += 1;
    // The id scopes the stylesheet mermaid embeds in the SVG, so it has to be
    // unique against every diagram already on the page.
    const {svg} = await mermaid.render(`obelisk-mermaid-${sequence}`, source);
    return svg;
}

/** How many renders may be waiting before the oldest are abandoned. */
const QUEUE_LIMIT = 16;

const pending: (() => Promise<void>)[] = [];
let draining = false;

/**
 * Runs diagram renders one at a time.
 *
 * Serialising is required for correctness (mermaid's config is global), and it
 * also keeps a burst of typing from starting a layout per keystroke. Only the
 * newest work is kept when the queue overflows: the entry a user is waiting on
 * is always the last one added.
 */
function enqueue(task: () => Promise<void>): void {
    pending.push(task);
    while (pending.length > QUEUE_LIMIT) pending.shift();
    if (draining) return;

    draining = true;
    void (async () => {
        try {
            for (let next = pending.shift(); next; next = pending.shift()) {
                // Per task, not around the loop: one diagram failing in a way
                // `paint` did not expect must not strand the ones behind it.
                await next().catch((error: unknown) => console.error(error));
            }
        } finally {
            draining = false;
        }
    })();
}

function errorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    return String(error);
}

/** Draws `source` into `host`, replacing whatever it held. */
async function paint(
    host: HTMLElement,
    source: string,
    style: DiagramStyle,
): Promise<void> {
    try {
        const svg = await renderDiagram(source, style);
        host.removeAttribute(DIAGRAM_ERROR_ATTR);
        host.innerHTML = sanitizeDiagram(svg);
    } catch (error) {
        // Shown rather than swallowed: with the preview open by default, a
        // silently blank panel reads as the app being broken, not the diagram.
        host.setAttribute(DIAGRAM_ERROR_ATTR, "");
        host.textContent = errorMessage(error);
    }
}

function diagramHost(source: string): HTMLElement {
    const host = document.createElement("div");
    host.className = DIAGRAM_CLASS;
    // The source is carried on the element because that is the only handle
    // `retintDiagrams` gets: Crepe serialises whatever it is handed through
    // DOMPurify into the panel, so the element identity does not survive.
    host.setAttribute(DIAGRAM_SOURCE_ATTR, encodeSource(source));
    return host;
}

type ApplyPreview = (value: null | string | HTMLElement) => void;

/**
 * Crepe's `renderPreview` hook: `null` for anything that is not a diagram,
 * `undefined` to say a result is coming (Crepe shows its loading label until
 * `apply` lands).
 */
export function diagramPreview(getStyle: () => DiagramStyle) {
    return (
        language: string,
        content: string,
        apply: ApplyPreview,
    ): null | undefined => {
        if (!isMermaid(language) || !content.trim()) return null;
        const host = diagramHost(content);
        enqueue(async () => {
            await paint(host, content, getStyle());
            apply(host);
        });
        return undefined;
    };
}

/** Marks the code block whose source is being typed in. */
export const EDITING_CLASS = "mermaid-editing";

const BLOCK_SELECTOR = ".milkdown-code-block";

/**
 * Pins a diagram's source open while the caret is inside it.
 *
 * Crepe decides preview-only mode once, when a block mounts, but whether a
 * block *has* a preview changes afterwards: open a fresh ```mermaid fence and
 * the first line that parses turns one on — which hides the CodeMirror the
 * caret is sitting in, blurring it mid-keystroke and dropping the rest of what
 * is being typed into the prose.
 *
 * A CSS-only guard cannot fix that: `:focus-within` stops matching the instant
 * the host is display:none, which is the same instant it would need to hold.
 * The class is set on focusin and cleared only once focus has genuinely left
 * the block, so it is already in place before the preview appears, and the
 * source never goes away underneath the person typing into it.
 */
export function pinSourceWhileEditing(root: HTMLElement): () => void {
    const enter = (event: FocusEvent) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        target.closest(BLOCK_SELECTOR)?.classList.add(EDITING_CLASS);
    };

    const leave = (event: FocusEvent) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const block = target.closest(BLOCK_SELECTOR);
        if (!block) return;
        // `relatedTarget` is whatever is gaining focus; moving between the
        // source and the block's own buttons is not leaving it.
        const next = event.relatedTarget;
        if (next instanceof Node && block.contains(next)) return;
        block.classList.remove(EDITING_CLASS);
    };

    root.addEventListener("focusin", enter);
    root.addEventListener("focusout", leave);
    return () => {
        root.removeEventListener("focusin", enter);
        root.removeEventListener("focusout", leave);
    };
}

/**
 * Redraws every diagram currently on screen under a new palette.
 *
 * The colours mermaid produces are baked into the SVG it emits, so a theme
 * switch cannot be a stylesheet swap the way the rest of the app's is
 * (DESIGN §5.3) — the diagrams have to be laid out again. They are found in
 * the DOM rather than tracked in a registry because Crepe hands out a fresh
 * apply-callback per render with nothing to correlate it to a block.
 */
export function retintDiagrams(style: DiagramStyle): void {
    const hosts = document.querySelectorAll<HTMLElement>(
        `.${DIAGRAM_CLASS}[${DIAGRAM_SOURCE_ATTR}]`,
    );
    for (const host of hosts) {
        const source = decodeSource(host.getAttribute(DIAGRAM_SOURCE_ATTR) ?? "");
        if (!source.trim()) continue;
        enqueue(() => paint(host, source, style));
    }
}
