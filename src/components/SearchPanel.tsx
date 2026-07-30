import {CaseSensitive, ChevronDown, ChevronRight, Regex, WholeWord, X,} from "lucide-react";
import type {ReactNode} from "react";
import {useEffect, useRef, useState} from "react";
import {EMPTY_OUTCOME, type SearchOptions, type SearchOutcome, searchProject,} from "../lib/search";

const DEBOUNCE_MS = 250;

type Props = {
    root: string | null;
    /** Replaces the panel title, so the Files/Search tabs can live there. */
    titleSlot?: ReactNode;
    /** Opens the file and jumps to the line. */
    onOpen: (path: string, line: number) => void;
};

/**
 * DESIGN §8.2 — results grouped per file, collapsible, in the right panel beside
 * the file tree. Searching is debounced rather than tied to a button so it reads
 * as live, but the walk is synchronous in Rust and a keystroke-per-search would
 * queue up work the user has already superseded.
 */
export function SearchPanel({root, titleSlot, onOpen}: Readonly<Props>) {
    const [query, setQuery] = useState("");
    const [options, setOptions] = useState<SearchOptions>({
        caseSensitive: false,
        wholeWord: false,
        regexp: false,
    });
    const [outcome, setOutcome] = useState<SearchOutcome>(EMPTY_OUTCOME);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const field = useRef<HTMLInputElement>(null);

    useEffect(() => {
        field.current?.focus();
    }, []);

    useEffect(() => {
        if (!root || !query.trim()) {
            setOutcome(EMPTY_OUTCOME);
            setError(null);
            setBusy(false);
            return;
        }
        setBusy(true);
        let cancelled = false;
        const timer = globalThis.setTimeout(() => {
            searchProject(root, query, options)
                .then((result) => {
                    if (cancelled) return;
                    setOutcome(result);
                    setError(null);
                })
                .catch((err) => {
                    if (cancelled) return;
                    setOutcome(EMPTY_OUTCOME);
                    // A half-typed regex lands here; it is a normal state, not a fault.
                    setError(String(err));
                })
                .finally(() => {
                    if (!cancelled) setBusy(false);
                });
        }, DEBOUNCE_MS);
        return () => {
            cancelled = true;
            globalThis.clearTimeout(timer);
        };
    }, [root, query, options]);

    const toggleFile = (path: string) =>
        setCollapsed((current) => {
            const next = new Set(current);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });

    const toggleOption = (key: keyof SearchOptions) => () =>
        setOptions((o) => ({...o, [key]: !o[key]}));

    const summary = () => {
        if (busy) return "searching…";
        if (!query.trim()) return "";
        const files = outcome.files.length;
        return `${outcome.total} in ${files} file${files === 1 ? "" : "s"}${outcome.truncated ? " (capped)" : ""}`;
    };

    return (
        <div className="panel">
            <div className="panel-header">
                {titleSlot ?? <span className="panel-title">Search</span>}
                <span className="panel-note">{summary()}</span>
            </div>

            <div className="search-controls">
                <div className={`find-input${error ? " invalid" : ""}`}>
                    <input
                        ref={field}
                        placeholder="Search the project"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Escape") setQuery("");
                        }}
                    />
                    {query && (
                        <button
                            className="icon-btn"
                            title="Clear"
                            onClick={() => setQuery("")}
                        >
                            <X size={13}/>
                        </button>
                    )}
                </div>
                <div className="find-toggles" role="group" aria-label="Search options">
                    <button
                        className={`icon-btn${options.caseSensitive ? " on" : ""}`}
                        title="Match case"
                        aria-pressed={options.caseSensitive}
                        onClick={toggleOption("caseSensitive")}
                    >
                        <CaseSensitive size={15}/>
                    </button>
                    <button
                        className={`icon-btn${options.wholeWord ? " on" : ""}`}
                        title="Whole word"
                        aria-pressed={options.wholeWord}
                        onClick={toggleOption("wholeWord")}
                    >
                        <WholeWord size={15}/>
                    </button>
                    <button
                        className={`icon-btn${options.regexp ? " on" : ""}`}
                        title="Regular expression"
                        aria-pressed={options.regexp}
                        onClick={toggleOption("regexp")}
                    >
                        <Regex size={15}/>
                    </button>
                </div>
            </div>

            <div className="panel-body">
                {!root && <div className="panel-empty">Select a project first</div>}
                {error && <div className="panel-error">{error}</div>}
                {root && !error && query.trim() && !busy && outcome.files.length === 0 && (
                    <div className="panel-empty">No matches</div>
                )}
                {outcome.truncated && outcome.files.length > 0 && (
                    <div className="panel-note search-capped">
                        Showing the first {outcome.total} matches — narrow the search to see
                        the rest.
                    </div>
                )}

                {outcome.files.map((file) => {
                    const isCollapsed = collapsed.has(file.path);
                    return (
                        <div key={file.path} className="search-file">
                            <button
                                className="search-file-head"
                                onClick={() => toggleFile(file.path)}
                                title={file.path}
                            >
                                {isCollapsed ? (
                                    <ChevronRight size={13}/>
                                ) : (
                                    <ChevronDown size={13}/>
                                )}
                                <span className="search-file-name">{file.relative}</span>
                                <span className="search-file-count">
                                    {file.matches.length}
                                    {file.truncated ? "+" : ""}
                                </span>
                            </button>

                            {!isCollapsed &&
                                file.matches.map((match) => (
                                    <button
                                        key={`${match.line}:${match.start}`}
                                        className="search-hit"
                                        onClick={() => onOpen(file.path, match.line)}
                                        title={`${file.relative}:${match.line}`}
                                    >
                                        <span className="search-line">{match.line}</span>
                                        {/* Sliced on the byte offsets Rust reported so the
                                            highlight lands on the actual match. */}
                                        <span className="search-text">
                                            {match.text.slice(0, match.start)}
                                            <mark>{match.text.slice(match.start, match.end)}</mark>
                                            {match.text.slice(match.end)}
                                        </span>
                                    </button>
                                ))}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
