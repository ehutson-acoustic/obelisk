import {markdown} from "@codemirror/lang-markdown";
import {
    findNext as cmFindNext,
    findPrevious as cmFindPrevious,
    replaceAll as cmReplaceAll,
    replaceNext as cmReplaceNext,
    search as cmSearch,
    SearchQuery as CmSearchQuery,
    setSearchQuery,
} from "@codemirror/search";
import {EditorSelection, EditorState, Prec} from "@codemirror/state";
import {oneDark} from "@codemirror/theme-one-dark";
import {EditorView, keymap} from "@codemirror/view";
import {Crepe} from "@milkdown/crepe";
import {editorViewCtx} from "@milkdown/kit/core";
import {TextSelection} from "@milkdown/kit/prose/state";
import type {EditorView as ProseView} from "@milkdown/kit/prose/view";
import {$prose} from "@milkdown/kit/utils";
import {basicSetup} from "codemirror";
import {Eye, FileCode} from "lucide-react";
import {
    findNext as pmFindNext,
    findPrev as pmFindPrev,
    replaceAll as pmReplaceAll,
    replaceNext as pmReplaceNext,
    search as pmSearch,
    SearchQuery as PmSearchQuery,
    setSearchState,
} from "prosemirror-search";
import {useEffect, useRef} from "react";
import {EMPTY_FIND_QUERY, type FindApi, type FindQuery, locate, type MatchCount, NO_MATCHES,} from "../lib/find";
import {frontmatterRemark, frontmatterSchema, frontmatterToggle,} from "../lib/frontmatter";
import type {Theme} from "../lib/theme";
import {buildToolbar} from "../lib/toolbar";
import type {EditorMode} from "../types";

// The light/dark half of Crepe's theme is swapped at runtime by lib/theme.ts;
// importing it here would bundle one variant and pin it.
import "@milkdown/crepe/theme/common/style.css";

type ViewProps = {
    value: string;
    readOnly?: boolean;
    cursor?: number;
    theme: Theme;
    /** Only used to nudge CodeMirror into re-measuring; see `Source`. */
    zoom: number;
    onChange: (value: string) => void;
    onCursorChange: (pos: number) => void;
    /** Published on mount, revoked on unmount, so the find bar follows the view. */
    onFindApi: (api: FindApi | null) => void;
};

/**
 * Both views mount imperatively and own their own document state, so `value`
 * and `cursor` are only ever initial values. The parent forces a fresh mount
 * (via `key`) when the file or its on-disk revision changes.
 */

/** ProseMirror-side find/replace, over `prosemirror-search` (DESIGN §8.1). */
function proseFindApi(view: ProseView): FindApi {
    const build = (query: FindQuery) =>
        new PmSearchQuery({
            search: query.search,
            replace: query.replace,
            caseSensitive: query.caseSensitive,
            wholeWord: query.wholeWord,
            regexp: query.regexp,
        });

    let current = build(EMPTY_FIND_QUERY);

    /**
     * `prosemirror-search` exposes no match count, so the matches are walked.
     * The step uses `matchStart + 1` as a floor because a zero-width regex match
     * would otherwise return the same position forever and hang the loop.
     */
    const ranges = () => {
        if (!current.valid) return [];
        const out: { from: number }[] = [];
        let pos = 0;
        for (; ;) {
            const result = current.findNext(view.state, pos);
            if (!result) break;
            out.push({from: result.from});
            pos = Math.max(result.to, result.matchStart + 1);
            if (out.length >= 10_000) break;
        }
        return out;
    };

    const count = (): MatchCount =>
        current.valid ? locate(ranges(), view.state.selection.from) : NO_MATCHES;

    const run = (command: typeof pmFindNext) => {
        command(view.state, view.dispatch, view);
        return count();
    };

    return {
        apply(query) {
            current = build(query);
            // An unfinished regex reports itself through `valid` rather than
            // throwing, so raise it the way the bar already handles errors.
            if (query.search && query.regexp && !current.valid) {
                throw new Error("invalid regular expression");
            }
            view.dispatch(setSearchState(view.state.tr, current));
            return count();
        },
        next: () => run(pmFindNext),
        prev: () => run(pmFindPrev),
        replaceNext: () => run(pmReplaceNext),
        replaceAll: () => run(pmReplaceAll),
        close() {
            current = build(EMPTY_FIND_QUERY);
            view.dispatch(setSearchState(view.state.tr, current));
            view.focus();
        },
    };
}

function Wysiwyg({
                     value,
                     readOnly,
                     cursor,
                     onChange,
                     onCursorChange,
                     onFindApi,
                 }: Readonly<ViewProps>) {
    const host = useRef<HTMLDivElement>(null);
    const onChangeRef = useRef(onChange);
    const onCursorRef = useRef(onCursorChange);
    const onFindApiRef = useRef(onFindApi);
    onChangeRef.current = onChange;
    onCursorRef.current = onCursorChange;
    onFindApiRef.current = onFindApi;

    useEffect(() => {
        if (!host.current) return;
        const crepe = new Crepe({
            root: host.current,
            defaultValue: value,
            features: {
                // Spec calls for a selection popup only — no bar across the top, and no
                // slash menu / drag handles that weren't asked for.
                [Crepe.Feature.TopBar]: false,
                [Crepe.Feature.BlockEdit]: false,
                [Crepe.Feature.ImageBlock]: false,
                [Crepe.Feature.Latex]: false,
                [Crepe.Feature.AI]: false,
            },
            featureConfigs: {
                [Crepe.Feature.Toolbar]: {buildToolbar},
            },
        });

        // Must be registered before create(), which is when defaultValue is parsed.
        crepe.addFeature((editor) => {
            editor.use(frontmatterRemark).use(frontmatterSchema).use(frontmatterToggle);
            // prosemirror-search resolves the same prosemirror-state instance
            // Milkdown does, so its plugin key matches and the state field is found.
            editor.use($prose(() => pmSearch()));
        });

        crepe.on((api) => {
            api.markdownUpdated((_ctx, md) => onChangeRef.current(md));
            api.selectionUpdated((_ctx, selection) =>
                onCursorRef.current(selection.head),
            );
        });

        let cancelled = false;
        // Destroying mid-create throws, and StrictMode unmounts immediately in dev,
        // so always wait for create() to settle before tearing down.
        const created = crepe.create().then(() => {
            if (cancelled) return;
            if (readOnly) crepe.setReadonly(true);
            crepe.editor.action((ctx) => {
                const view = ctx.get(editorViewCtx);
                onFindApiRef.current(proseFindApi(view));
                if (cursor == null) return;
                const pos = Math.min(Math.max(cursor, 0), view.state.doc.content.size);
                // No view.focus() — restoring position shouldn't steal focus on load.
                view.dispatch(
                    view.state.tr.setSelection(
                        TextSelection.near(view.state.doc.resolve(pos)),
                    ),
                );
            });
        });
        return () => {
            cancelled = true;
            onFindApiRef.current(null);
            created.finally(() => crepe.destroy());
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return <div className="crepe-host" ref={host}/>;
}

/** CodeMirror-side find/replace, over `@codemirror/search` (DESIGN §8.1). */
function codeFindApi(view: EditorView): FindApi {
    let current: FindQuery = EMPTY_FIND_QUERY;

    const build = (query: FindQuery) =>
        new CmSearchQuery({
            search: query.search,
            replace: query.replace,
            caseSensitive: query.caseSensitive,
            wholeWord: query.wholeWord,
            regexp: query.regexp,
        });

    const count = (): MatchCount => {
        const query = build(current);
        if (!query.valid) return NO_MATCHES;
        const out: { from: number }[] = [];
        const cursor = query.getCursor(view.state);
        for (let step = cursor.next(); !step.done; step = cursor.next()) {
            out.push({from: step.value.from});
            if (out.length >= 10_000) break;
        }
        return locate(out, view.state.selection.main.from);
    };

    const run = (command: typeof cmFindNext) => {
        command(view);
        return count();
    };

    return {
        apply(query) {
            current = query;
            const built = build(query);
            if (query.search && query.regexp && !built.valid) {
                throw new Error("invalid regular expression");
            }
            view.dispatch({effects: setSearchQuery.of(built)});
            return count();
        },
        next: () => run(cmFindNext),
        prev: () => run(cmFindPrevious),
        replaceNext: () => run(cmReplaceNext),
        replaceAll: () => run(cmReplaceAll),
        close() {
            current = EMPTY_FIND_QUERY;
            view.dispatch({effects: setSearchQuery.of(build(current))});
            view.focus();
        },
    };
}

function Source({
                    value,
                    readOnly,
                    cursor,
                    theme,
                    zoom,
                    onChange,
                    onCursorChange,
                    onFindApi,
                }: Readonly<ViewProps>) {
    const host = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const onChangeRef = useRef(onChange);
    const onCursorRef = useRef(onCursorChange);
    const onFindApiRef = useRef(onFindApi);
    onChangeRef.current = onChange;
    onCursorRef.current = onCursorChange;
    onFindApiRef.current = onFindApi;

    useEffect(() => {
        if (!host.current) return;
        const startAt =
            cursor == null ? null : Math.min(Math.max(cursor, 0), value.length);
        const state = EditorState.create({
            doc: value,
            selection:
                startAt == null ? undefined : EditorSelection.cursor(startAt),
            extensions: [
                basicSetup,
                markdown(),
                // The search *state* only. Its own panel is never opened — the find
                // bar is shared with WYSIWYG so both modes look and behave alike.
                cmSearch({top: true}),
                // `basicSetup` bundles @codemirror/search's keymap, whose Mod-f and
                // Mod-Alt-f open that panel. Swallowed at the highest precedence so
                // the shared bar stays the only search UI; the event still reaches
                // the window handler that opens it.
                Prec.highest(
                    keymap.of([
                        {key: "Mod-f", run: () => true},
                        {key: "Mod-h", run: () => true},
                        {key: "Mod-Alt-f", run: () => true},
                    ]),
                ),
                ...(theme === "dark" ? [oneDark] : []),
                EditorView.lineWrapping,
                EditorView.editable.of(!readOnly),
                EditorView.updateListener.of((u) => {
                    if (u.docChanged) onChangeRef.current(u.state.doc.toString());
                    if (u.selectionSet || u.docChanged) {
                        onCursorRef.current(u.state.selection.main.head);
                    }
                }),
            ],
        });
        const view = new EditorView({state, parent: host.current});
        viewRef.current = view;
        onFindApiRef.current(codeFindApi(view));
        // CodeMirror does not scroll to a selection handed to it at construction,
        // so a restored cursor deep in the file left the document at the top with
        // the active line highlighted somewhere out of sight. Most visible when
        // opening a search hit (DESIGN §8.2). Centred rather than merely revealed
        // so the match lands where the eye already is. Dispatched after the view
        // exists because it needs real measured line heights.
        if (startAt != null) {
            view.dispatch({
                effects: EditorView.scrollIntoView(startAt, {y: "center"}),
            });
        }
        return () => {
            onFindApiRef.current(null);
            viewRef.current = null;
            view.destroy();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /**
     * The font size arrives through CSS (`calc(… * var(--editor-zoom))`), which
     * CodeMirror has no way to observe. It caches character metrics, so without an
     * explicit re-measure clicks and the cursor stay calibrated to the old size
     * and land a character or two off (DESIGN §7).
     */
    useEffect(() => {
        viewRef.current?.requestMeasure();
    }, [zoom]);

    return <div className="cm-host" ref={host}/>;
}

type EditorProps = ViewProps & {
    mode: EditorMode;
    onModeChange: (mode: EditorMode) => void;
    /** Bumped when the file is reloaded from disk, to force a remount. */
    revision: number;
    path: string | null;
};

export function Editor({
                           mode,
                           onModeChange,
                           revision,
                           path,
                           ...view
                       }: EditorProps) {
    if (!path) {
        return (
            <div className="editor-panel">
                <div className="editor-empty">No file open</div>
            </div>
        );
    }

    const key = `${path}:${revision}`;

    return (
        <div className="editor-panel">
            <div className="editor-mode-toggle" role="group" aria-label="Editor mode">
                <button
                    className={mode === "wysiwyg" ? "active" : ""}
                    onClick={() => onModeChange("wysiwyg")}
                    title="WYSIWYG"
                    aria-pressed={mode === "wysiwyg"}
                >
                    <Eye size={14}/> WYSIWYG
                </button>
                <button
                    className={mode === "source" ? "active" : ""}
                    onClick={() => onModeChange("source")}
                    title="Markdown source"
                    aria-pressed={mode === "source"}
                >
                    <FileCode size={14}/> Source
                </button>
            </div>
            <div className="editor-scroll">
                {mode === "wysiwyg" ? (
                    // Crepe restyles via the swapped stylesheet, so no remount needed.
                    <Wysiwyg key={`w:${key}`} {...view} />
                ) : (
                    // CodeMirror takes its theme as an extension, fixed at construction.
                    <Source key={`s:${key}:${view.theme}`} {...view} />
                )}
            </div>
        </div>
    );
}
