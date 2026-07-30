import {CaseSensitive, ChevronDown, ChevronUp, Regex, Replace, ReplaceAll, WholeWord, X,} from "lucide-react";
import {useEffect, useRef, useState} from "react";
import {EMPTY_FIND_QUERY, type FindApi, type FindQuery, type MatchCount, NO_MATCHES,} from "../lib/find";

type Props = {
    /** Null while no view is mounted; the bar disables itself rather than vanish. */
    api: FindApi | null;
    showReplace: boolean;
    onShowReplaceChange: (value: boolean) => void;
    onClose: () => void;
    readOnly: boolean;
};

/**
 * DESIGN §8.1 — identical in both editor modes. The query lives here rather than
 * in either view, so switching WYSIWYG ↔ source keeps what you typed.
 */
export function FindBar({
                            api,
                            showReplace,
                            onShowReplaceChange,
                            onClose,
                            readOnly,
                        }: Readonly<Props>) {
    const [query, setQuery] = useState<FindQuery>(EMPTY_FIND_QUERY);
    const [count, setCount] = useState<MatchCount>(NO_MATCHES);
    const [error, setError] = useState<string | null>(null);
    const field = useRef<HTMLInputElement>(null);

    useEffect(() => {
        field.current?.focus();
        field.current?.select();
    }, []);

    // Re-applied when the query changes *or* a different view publishes an api,
    // which is what carries the query across a mode switch.
    useEffect(() => {
        if (!api) return;
        if (!query.search) {
            setCount(NO_MATCHES);
            setError(null);
            api.apply(query);
            return;
        }
        try {
            setCount(api.apply(query));
            setError(null);
        } catch (err) {
            // An incomplete regex is the normal case here, not an exception.
            setCount(NO_MATCHES);
            setError(err instanceof Error ? err.message : String(err));
        }
    }, [api, query]);

    const step = (action: "next" | "prev") => {
        if (!api || !query.search) return;
        setCount(action === "next" ? api.next() : api.prev());
    };

    const toggle = (key: "caseSensitive" | "wholeWord" | "regexp") => () =>
        setQuery((q) => ({...q, [key]: !q[key]}));

    function getSearchCount() {
        return query.search
            ? `${count.current}/${count.total}`
            : "";
    }

    const status = error
        ? "bad pattern"
        : getSearchCount();

    return (
        <div className="find-bar">
            <div className="find-row">
                <div className={`find-input${error ? " invalid" : ""}`}>
                    <input
                        ref={field}
                        placeholder="Find"
                        value={query.search}
                        onChange={(e) => setQuery({...query, search: e.target.value})}
                        onKeyDown={(e) => {
                            if (e.key === "Escape") {
                                e.preventDefault();
                                onClose();
                            }
                            if (e.key !== "Enter") return;
                            e.preventDefault();
                            step(e.shiftKey ? "prev" : "next");
                        }}
                    />
                    <span className="find-count">{status}</span>
                </div>

                <div className="find-toggles" role="group" aria-label="Search options">
                    <button
                        className={`icon-btn${query.caseSensitive ? " on" : ""}`}
                        title="Match case"
                        aria-pressed={query.caseSensitive}
                        onClick={toggle("caseSensitive")}
                    >
                        <CaseSensitive size={15}/>
                    </button>
                    <button
                        className={`icon-btn${query.wholeWord ? " on" : ""}`}
                        title="Whole word"
                        aria-pressed={query.wholeWord}
                        onClick={toggle("wholeWord")}
                    >
                        <WholeWord size={15}/>
                    </button>
                    <button
                        className={`icon-btn${query.regexp ? " on" : ""}`}
                        title="Regular expression"
                        aria-pressed={query.regexp}
                        onClick={toggle("regexp")}
                    >
                        <Regex size={15}/>
                    </button>
                </div>

                <button
                    className="icon-btn"
                    title="Previous match (Shift+Enter)"
                    disabled={!count.total}
                    onClick={() => step("prev")}
                >
                    <ChevronUp size={16}/>
                </button>
                <button
                    className="icon-btn"
                    title="Next match (Enter)"
                    disabled={!count.total}
                    onClick={() => step("next")}
                >
                    <ChevronDown size={16}/>
                </button>
                <button
                    className={`icon-btn${showReplace ? " on" : ""}`}
                    title="Toggle replace"
                    aria-pressed={showReplace}
                    disabled={readOnly}
                    onClick={() => onShowReplaceChange(!showReplace)}
                >
                    <Replace size={15}/>
                </button>
                <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
                    <X size={16}/>
                </button>
            </div>

            {showReplace && !readOnly && (
                <div className="find-row">
                    <div className="find-input">
                        <input
                            placeholder="Replace with"
                            value={query.replace}
                            onChange={(e) => setQuery({...query, replace: e.target.value})}
                            onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                    e.preventDefault();
                                    onClose();
                                }
                                if (e.key !== "Enter" || !api) return;
                                e.preventDefault();
                                setCount(api.replaceNext());
                            }}
                        />
                    </div>
                    <button
                        className="btn"
                        disabled={!api || !count.total}
                        onClick={() => api && setCount(api.replaceNext())}
                    >
                        <Replace size={14}/> Replace
                    </button>
                    <button
                        className="btn"
                        disabled={!api || !count.total}
                        onClick={() => api && setCount(api.replaceAll())}
                    >
                        <ReplaceAll size={14}/> All
                    </button>
                </div>
            )}
        </div>
    );
}
