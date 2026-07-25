import { FitAddon } from "@xterm/addon-fit";
import { Terminal as Xterm } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { spawn } from "tauri-pty";

import "@xterm/xterm/css/xterm.css";

type Props = {
  cwd: string;
  shell: string;
  startupCommand?: string;
  active: boolean;
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
  onExit,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const term = new Xterm({
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      scrollback: 10000,
      theme: {
        background: "#1e2128",
        foreground: "#e4e6eb",
        cursor: "#e4e6eb",
        selectionBackground: "#3a4050",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fitRef.current = fit;

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
      env: { TERM: "xterm-256color" },
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
      term.onResize(({ cols, rows }) => pty.resize(cols, rows)),
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
      style={{ display: active ? "block" : "none" }}
      ref={host}
    />
  );
}
