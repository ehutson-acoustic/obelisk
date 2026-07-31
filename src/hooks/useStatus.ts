import {useEffect, useState} from "react";

/** What every hook here is given so it can report to the footer. */
export type SetStatus = (message: string | null) => void;

/**
 * The footer's transient message. It clears itself on a timer rather than being
 * cleared by whoever set it, so reporting something is always a single call and
 * no caller owns the cleanup.
 */
export function useStatus() {
    const [status, setStatus] = useState<string | null>(null);

    useEffect(() => {
        if (!status) return;
        const t = globalThis.setTimeout(() => setStatus(null), 3000);
        return () => globalThis.clearTimeout(t);
    }, [status]);

    return {status, setStatus};
}
