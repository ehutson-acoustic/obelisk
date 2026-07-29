/**
 * One find/replace contract over two unrelated editors (DESIGN §8.1).
 *
 * WYSIWYG is backed by `prosemirror-search` and source mode by
 * `@codemirror/search` — both first-party for their editor, and their
 * `SearchQuery` shapes happen to line up almost exactly. Each view publishes a
 * `FindApi` on mount; the bar is a plain controlled component that knows nothing
 * about either library.
 */

export type FindQuery = {
    search: string;
    replace: string;
    caseSensitive: boolean;
    wholeWord: boolean;
    regexp: boolean;
};

export const EMPTY_FIND_QUERY: FindQuery = {
    search: "",
    replace: "",
    caseSensitive: false,
    wholeWord: false,
    regexp: false,
};

/** `current` is 1-based, or 0 when the cursor is not sitting on a match. */
export type MatchCount = { current: number; total: number };

export const NO_MATCHES: MatchCount = {current: 0, total: 0};

/**
 * Both editors move the selection onto the match they land on, so the position
 * in the list is found by comparing against the selection's own start.
 */
export function locate(
    ranges: readonly { from: number }[],
    selectionFrom: number,
): MatchCount {
    const index = ranges.findIndex((range) => range.from === selectionFrom);
    return {current: index < 0 ? 0 : index + 1, total: ranges.length};
}

export type FindApi = {
    /** Sets the query, highlights matches, and reports the count. */
    apply: (query: FindQuery) => MatchCount;
    next: () => MatchCount;
    prev: () => MatchCount;
    replaceNext: () => MatchCount;
    replaceAll: () => MatchCount;
    /** Drops highlighting and returns focus to the document. */
    close: () => void;
};
