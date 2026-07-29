import * as Popover from "@radix-ui/react-popover";
import {Check, GitBranch, Plus} from "lucide-react";
import {useEffect, useMemo, useRef, useState} from "react";
import type {Branches, RepoState} from "../lib/checkpoints";

/**
 * What a switch is aiming at. Remote entries carry the tracking ref because
 * checking one out means `switch --track origin/<name>`, not `switch <name>`.
 */
export type BranchTarget = { name: string; reference?: string };

type Props = {
    state: RepoState | null;
    branches: Branches;
    busy: boolean;
    disabled: boolean;
    /** Refreshes the list; branches change from the terminal too. */
    onOpen: () => void;
    /** Both reject with git's own message, which is shown verbatim. */
    onSwitch: (target: BranchTarget) => Promise<void>;
    onCreate: (name: string) => Promise<void>;
    onStash: (label: string) => Promise<void>;
};

/**
 * Modeled on GitHub's branch picker (DESIGN §3.8): filter, list, and a create
 * row that appears when what you typed matches nothing. Popover rather than
 * DropdownMenu because a menu's typeahead and roving focus fight a text input.
 */
export function BranchMenu({
                               state,
                               branches,
                               busy,
                               disabled,
                               onOpen,
                               onSwitch,
                               onCreate,
                               onStash,
                           }: Readonly<Props>) {
    const [open, setOpen] = useState(false);
    const [filter, setFilter] = useState("");
    const [error, setError] = useState<string | null>(null);
    /** The target a refused switch was aiming at, so stashing can retry it. */
    const [pending, setPending] = useState<BranchTarget | null>(null);
    const [working, setWorking] = useState(false);
    const input = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (!open) return;
        setFilter("");
        setError(null);
        setPending(null);
        onOpen();
        // Popover moves focus to the content itself, so the field has to ask.
        input.current?.focus();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const query = filter.trim();
    const matches = (name: string) =>
        name.toLowerCase().includes(query.toLowerCase());

    const local = useMemo(
        () => branches.local.filter(matches),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [branches.local, query],
    );
    const remote = useMemo(
        () => branches.remote.filter((b) => matches(b.name)),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [branches.remote, query],
    );

    // Only offered when nothing already carries the name — otherwise the row
    // would propose creating a branch that exists.
    const canCreate =
        query.length > 0 &&
        !branches.local.includes(query) &&
        !branches.remote.some((b) => b.name === query);

    const run = async (action: () => Promise<void>, target?: BranchTarget) => {
        setWorking(true);
        setError(null);
        try {
            await action();
            setPending(null);
            setOpen(false);
        } catch (err) {
            setError(String(err));
            // Remembered so "Stash changes and switch" knows where it was going.
            setPending(target ?? null);
        } finally {
            setWorking(false);
        }
    };

    const stashAndRetry = async () => {
        if (!pending) return;
        await run(async () => {
            await onStash(pending.name);
            await onSwitch(pending);
        }, pending);
    };

    const label = state?.branch ?? state?.head ?? "no branch";
    const detached = !!state?.repo && !state.branch;

    return (
        <Popover.Root open={open} onOpenChange={setOpen}>
            <Popover.Trigger asChild>
                <button
                    className="btn branch-btn"
                    disabled={disabled || busy}
                    title={
                        state?.repo
                            ? `Current branch: ${label}`
                            : "Not a git repository"
                    }
                >
                    <GitBranch size={14}/>
                    <span className={`branch-name${detached ? " detached" : ""}`}>
                        {label}
                    </span>
                </button>
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content className="popover branch-popover" align="end" sideOffset={4}>
                    <div className="branch-head">
                        <span>Switch branches</span>
                    </div>
                    <input
                        ref={input}
                        className="branch-filter"
                        placeholder="Find or create a branch…"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            e.preventDefault();
                            // Enter takes the single obvious action: the one match, or
                            // creating what was typed.
                            if (local.length === 1 && remote.length === 0) {
                                run(() => onSwitch({name: local[0]}), {name: local[0]});
                            } else if (local.length === 0 && remote.length === 1) {
                                run(() => onSwitch(remote[0]), remote[0]);
                            } else if (canCreate && local.length === 0 && remote.length === 0) {
                                run(() => onCreate(query));
                            }
                        }}
                    />

                    <div className="branch-list">
                        {local.length === 0 && remote.length === 0 && !canCreate && (
                            <div className="branch-empty">No branches match.</div>
                        )}

                        {local.length > 0 && (
                            <div className="branch-group">
                                {local.map((name) => (
                                    <button
                                        key={name}
                                        className={`branch-item${name === branches.current ? " current" : ""}`}
                                        disabled={working}
                                        onClick={() => run(() => onSwitch({name}), {name})}
                                    >
                                        <span className="branch-check">
                                            {name === branches.current && <Check size={13}/>}
                                        </span>
                                        <span className="branch-item-name">{name}</span>
                                        {name === branches.defaultBranch && (
                                            <span className="branch-badge">default</span>
                                        )}
                                    </button>
                                ))}
                            </div>
                        )}

                        {remote.length > 0 && (
                            <div className="branch-group">
                                <div className="branch-group-label">Remote</div>
                                {remote.map((b) => (
                                    <button
                                        key={b.reference}
                                        className="branch-item"
                                        disabled={working}
                                        title={`Create ${b.name} tracking ${b.reference}`}
                                        onClick={() => run(() => onSwitch(b), b)}
                                    >
                                        <span className="branch-check"/>
                                        <span className="branch-item-name">{b.name}</span>
                                        <span className="branch-ref">{b.reference}</span>
                                    </button>
                                ))}
                            </div>
                        )}

                        {canCreate && (
                            <div className="branch-group">
                                <button
                                    className="branch-item create"
                                    disabled={working}
                                    onClick={() => run(() => onCreate(query))}
                                >
                                    <span className="branch-check">
                                        <Plus size={13}/>
                                    </span>
                                    <span className="branch-item-name">
                                        Create branch <strong>{query}</strong>
                                        {branches.current && ` from ${branches.current}`}
                                    </span>
                                </button>
                            </div>
                        )}
                    </div>

                    {error && (
                        <div className="branch-error">
                            <pre>{error}</pre>
                            {pending && (
                                <div className="branch-error-actions">
                                    <button
                                        className="btn"
                                        disabled={working}
                                        onClick={() => {
                                            setError(null);
                                            setPending(null);
                                        }}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        className="btn primary"
                                        disabled={working}
                                        onClick={stashAndRetry}
                                    >
                                        Stash changes and switch
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}
