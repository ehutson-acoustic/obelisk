import {invoke} from "@tauri-apps/api/core";

export type SearchMatch = {
    /** 1-based. */
    line: number;
    /** The matching line, without its terminator. */
    text: string;
    /** Byte offsets of the match inside `text`. */
    start: number;
    end: number;
};

export type FileMatches = {
    /** Absolute, for opening. */
    path: string;
    /** Project-relative, for display. */
    relative: string;
    matches: SearchMatch[];
    /** This file had more matches than the per-file cap allowed. */
    truncated: boolean;
};

export type SearchOutcome = {
    files: FileMatches[];
    total: number;
    /** Some result was dropped by a cap; the panel says so rather than implying completeness. */
    truncated: boolean;
};

export type SearchOptions = {
    caseSensitive: boolean;
    wholeWord: boolean;
    regexp: boolean;
};

/** Rust deserializes these snake_cased. */
type RawOptions = {
    case_sensitive: boolean;
    whole_word: boolean;
    regexp: boolean;
};

export const EMPTY_OUTCOME: SearchOutcome = {
    files: [],
    total: 0,
    truncated: false,
};

/** DESIGN §8.2 — ripgrep's crates behind one command; rejects on a bad pattern. */
export function searchProject(
    project: string,
    query: string,
    options: SearchOptions,
): Promise<SearchOutcome> {
    const raw: RawOptions = {
        case_sensitive: options.caseSensitive,
        whole_word: options.wholeWord,
        regexp: options.regexp,
    };
    return invoke<SearchOutcome>("search_project", {project, query, options: raw});
}
