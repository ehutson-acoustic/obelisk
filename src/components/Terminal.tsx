import {FitAddon} from "@xterm/addon-fit";
import {Terminal as Xterm} from "@xterm/xterm";
import {useEffect, useRef} from "react";
import {spawn} from "tauri-pty";
import {type Theme, xtermTheme} from "../lib/theme";

import "@xterm/xterm/css/xterm.css";

type Props = {
    cwd: string;
    shell: string;
    startupCommand?: string;
    active: boolean;
    theme: Theme;
    onExit: () => void;
};

/**
 * One xterm + one PTY, mounted once and kept alive for the tab's lifetime.
 * Inactive tabs stay mounted but hidden so their scrollback and running
 * processes survive tab switches.
 */
export function TerminalView({
                                 cwd,
                                 shell,
                                 startupCommand,
                                 active,
                                 theme,
                                 onExit,
                             }: Readonly<Props>) {
    const host = useRef<HTMLDivElement>(null);
    const fitRef = useRef<FitAddon | null>(null);
    const termRef = useRef<Xterm | null>(null);
    const onExitRef = useRef(onExit);
    const themeRef = useRef(theme);
    onExitRef.current = onExit;
    themeRef.current = theme;

    useEffect(() => {
        const el = host.current;
        if (!el) return;

        const term = new Xterm({
            fontFamily: "ui-monospace, SFMono-Regular, \"SF Mono\", Menlo, monospace",
            fontSize: 13,
            cursorBlink: true,
            scrollback: 10000,
            theme: xtermTheme(themeRef.current),
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(el);
        fitRef.current = fit;
        termRef.current = term;

        // fit() divides by the measured cell size, so it produces NaN dimensions
        // when the panel is collapsed or the tab is hidden.
        const safeFit = () => {
            if (el.clientHeight < 20 || el.clientWidth < 20) return;
            try {
                fit.fit();
            } catch {
                /* transient layout state */
            }
        };
        safeFit();

        const pty = spawn(shell, [], {
            cwd,
            cols: term.cols || 80,
            rows: term.rows || 24,
            // portable-pty inherits the parent environment; this only pins TERM.
            env: {TERM: "xterm-256color"},
        });

        // Per-project startup command (DESIGN §4). Written into the interactive
        // shell rather than exec'd, so the tab survives the command exiting.
        // It has to wait for the shell's first output: a write issued before the
        // shell finishes reading its startup files is discarded as type-ahead.
        let startupTimer: number | undefined;
        let startupSent = false;
        const sendStartup = () => {
            if (startupSent || !startupCommand?.trim()) return;
            startupSent = true;
            startupTimer = window.setTimeout(
                () => pty.write(`${startupCommand}\n`),
                120,
            );
        };

        const subs = [
            pty.onData((data) => {
                term.write(data);
                sendStartup();
            }),
            pty.onExit(() => onExitRef.current()),
            term.onData((data) => pty.write(data)),
            term.onResize(({cols, rows}) => pty.resize(cols, rows)),
        ];

        const observer = new ResizeObserver(safeFit);
        observer.observe(el);

        return () => {
            observer.disconnect();
            if (startupTimer) window.clearTimeout(startupTimer);
            for (const sub of subs) sub.dispose();
            try {
                pty.kill();
            } catch {
                /* already gone */
            }
            term.dispose();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Recolor in place rather than remounting, which would kill the shell.
    useEffect(() => {
        if (termRef.current) termRef.current.options.theme = xtermTheme(theme);
    }, [theme]);

    // Re-fit when this tab is revealed; it couldn't measure while hidden.
    useEffect(() => {
        if (!active) return;
        const id = window.setTimeout(() => {
            const el = host.current;
            if (!el || el.clientHeight < 20) return;
            try {
                fitRef.current?.fit();
            } catch {
                /* transient layout state */
            }
        }, 0);
        return () => window.clearTimeout(id);
    }, [active]);

    return (
        <div
            className="terminal-view"
            style={{display: active ? "block" : "none"}}
            ref={host}
        />
    );
}
