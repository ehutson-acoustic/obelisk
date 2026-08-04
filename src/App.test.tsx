// @vitest-environment jsdom
import {act, cleanup, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {DEFAULT_SESSION, type Session} from "./types";

/**
 * A smoke test over the whole tree. `App` wires eleven hooks to seven components
 * and none of that is reachable from the unit tests in `lib/`, so this is the
 * only place a broken hook order, a dropped callback or a stale ref shows up
 * before the app is running.
 *
 * Everything Tauri is mocked at the module boundary against an in-memory
 * filesystem; the components below it are real, except `Editor` — the imperative
 * Crepe/CodeMirror views own their own document state and mounting them here
 * would test the libraries rather than the wiring. The stub publishes its props
 * instead, which is what lets the autosave test drive a keystroke.
 */

const CONFIG_DIR = "/config";
const PROJECT_DIR = "/work/notes";
const FILE = "/work/notes/note.md";

/** Path to contents. Reset per test. */
let files = new Map<string, string>();

/** What `take_open_requests` hands back — files the OS asked us to open. */
let openRequests: string[] = [];

/** The props `Editor` was last rendered with, so tests can act as the view. */
type EditorProps = {
    value: string;
    onChange: (text: string) => void;
};
let editorProps: EditorProps | null = null;

vi.mock("@tauri-apps/api/path", () => ({
    appConfigDir: async () => CONFIG_DIR,
    join: async (...parts: string[]) => parts.join("/"),
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
    exists: async (path: string) => files.has(path),
    mkdir: async () => undefined,
    readDir: async () => [],
    readTextFile: async (path: string) => {
        const text = files.get(path);
        if (text === undefined) throw new Error(`ENOENT: ${path}`);
        return text;
    },
    writeTextFile: async (path: string, text: string) => {
        files.set(path, text);
    },
    // Nothing here fires watch events; the external-change path is the
    // watcher's own concern and is covered by the Rust side.
    watch: async () => () => undefined,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({open: async () => null}));

// Nothing here emits, so the only thing under test is the drain path; a warm
// open is the same code reached from the listener.
vi.mock("@tauri-apps/api/event", () => ({
    listen: async () => () => undefined,
}));

// xterm needs a canvas and tauri-pty has no resolvable browser entry, so the
// terminal view is stubbed at its module. No test opens a terminal tab, so it
// is never rendered either way — this only keeps the import chain out of jsdom.
vi.mock("./components/Terminal", () => ({
    TerminalView: () => <div data-testid="terminal-stub"/>,
}));

vi.mock("@tauri-apps/api/core", () => ({
    invoke: async (cmd: string, args?: Record<string, unknown>) => {
        switch (cmd) {
            case "take_open_requests": {
                const pending = openRequests;
                openRequests = [];
                return pending;
            }
            case "project_dir_for":
                // No repo in the fake filesystem, so the real command's fallback:
                // the containing directory.
                return String(args?.file).split("/").slice(0, -1).join("/");
            case "default_shell":
                return "/bin/zsh";
            case "git_available":
                return true;
            case "repo_state":
                return {repo: true, branch: "main", head: "abc1234", blocked: null};
            case "checkpoint_list":
                return [];
            case "checkpoint_status":
                return {
                    changed: false,
                    tracked: true,
                    diff: "",
                    ignored: false,
                    staged: false,
                };
            case "branch_list":
                return {current: "main", default_branch: "main", local: ["main"], remote: []};
            case "search_project":
                return {matches: [], truncated: false};
            default:
                return null;
        }
    },
}));

// The stub's test id must not be a panel id: react-resizable-panels puts
// `data-testid` on every panel it renders, taken from that panel's `id`, so a
// stub called "editor" collides with the editor panel itself.
vi.mock("./components/Editor", () => ({
    Editor: (props: EditorProps) => {
        editorProps = props;
        return <div data-testid="editor-stub">{props.value}</div>;
    },
}));

/** Writes a session.json for `loadSession` to find. */
function seedSession(session: Partial<Session>) {
    files.set(
        `${CONFIG_DIR}/session.json`,
        JSON.stringify({...DEFAULT_SESSION, ...session}),
    );
}

const WITH_FILE: Partial<Session> = {
    projects: [{id: "p1", name: "Notes", color: "#888888", dir: PROJECT_DIR}],
    activeProjectId: "p1",
    openFiles: [{path: FILE}],
    activeFilePath: FILE,
};

/**
 * Mounts and waits for the first paint. The session load and everything it
 * triggers are still in flight after this returns, so anything that depends on
 * it needs its own `waitFor`.
 */
async function mountApp() {
    const {default: App} = await import("./App");
    const view = render(<App/>);
    await screen.findByTestId("editor-stub");
    return view;
}

beforeAll(() => {
    // Panels, Radix and ProseMirror touch a few browser APIs jsdom lacks.
    globalThis.ResizeObserver ??= class {
        observe() {
        }

        unobserve() {
        }

        disconnect() {
        }
    } as never;
    Element.prototype.scrollIntoView ??= (() => undefined) as never;
});

beforeEach(() => {
    files = new Map([[FILE, "# Note\n"]]);
    editorProps = null;
    openRequests = [];
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe("App", () => {
    it("renders the shell when the session has no file open", async () => {
        seedSession({});
        await mountApp();

        // The footer path and the versions panel each report the empty state,
        // which is `useDocument` and `useCheckpoints` both reaching the tree.
        expect(screen.getByText("No file open", {selector: "bdi"})).toBeTruthy();
        expect(
            screen.getByText("No file open", {selector: ".panel-empty"}),
        ).toBeTruthy();
        expect(screen.getByRole("tab", {name: "Files"})).toBeTruthy();
        expect(screen.getByRole("tab", {name: "Search"})).toBeTruthy();
        // Nothing to commit, so the button stays out of reach.
        expect(
            screen.getByRole("button", {name: /Checkpoint/}).hasAttribute("disabled"),
        ).toBe(true);
    });

    it("restores an open file from the session and loads it from disk", async () => {
        seedSession(WITH_FILE);
        await mountApp();

        expect(screen.getByText("note.md")).toBeTruthy();
        await waitFor(() => expect(editorProps?.value).toBe("# Note\n"));
        // The footer shows the full path once something is open.
        expect(screen.getByText(FILE)).toBeTruthy();
    });

    it("enables checkpointing once a file in a git project is open", async () => {
        seedSession(WITH_FILE);
        await mountApp();

        await waitFor(() =>
            expect(
                screen
                    .getByRole("button", {name: /Checkpoint/})
                    .hasAttribute("disabled"),
            ).toBe(false),
        );
    });

    it("autosaves an edit a second after typing stops, and not before", async () => {
        vi.useFakeTimers({shouldAdvanceTime: true});
        seedSession(WITH_FILE);
        await mountApp();
        await waitFor(() => expect(editorProps?.value).toBe("# Note\n"));

        act(() => editorProps?.onChange("# Note\n\nEdited.\n"));

        await act(async () => {
            vi.advanceTimersByTime(900);
        });
        expect(files.get(FILE)).toBe("# Note\n");

        await act(async () => {
            vi.advanceTimersByTime(200);
        });
        await waitFor(() => expect(files.get(FILE)).toBe("# Note\n\nEdited.\n"));
    });

    it("opens a file the OS queued before launch, adopting its project", async () => {
        const outside = "/elsewhere/inbox/todo.md";
        files.set(outside, "# Todo\n");
        openRequests = [outside];
        seedSession({});
        await mountApp();

        await waitFor(() => expect(editorProps?.value).toBe("# Todo\n"));
        expect(screen.getByText("todo.md")).toBeTruthy();
        // No project contained it, so one was derived from the file's directory —
        // without which there is no checkpointing and no terminal cwd.
        expect(screen.getByText("inbox")).toBeTruthy();
        expect(screen.getByText("/elsewhere/inbox")).toBeTruthy();
    });

    it("opens a queued file into the project that already contains it", async () => {
        const sibling = `${PROJECT_DIR}/sibling.md`;
        files.set(sibling, "# Sibling\n");
        openRequests = [sibling];
        seedSession(WITH_FILE);
        await mountApp();

        await waitFor(() => expect(editorProps?.value).toBe("# Sibling\n"));
        // One project card, not two: the configured project was reused.
        expect(screen.getAllByText("Notes")).toHaveLength(1);
        expect(screen.queryByText("notes")).toBeNull();
    });

    it("collapses and expands the right sidebar from the header toggle", async () => {
        seedSession({});
        await mountApp();

        const toggle = () => screen.getByRole("button", {name: /right sidebar/});
        expect(toggle().getAttribute("title")).toBe("Hide right sidebar");

        act(() => toggle().click());
        await waitFor(() =>
            expect(toggle().getAttribute("title")).toBe("Show right sidebar"),
        );

        act(() => toggle().click());
        await waitFor(() =>
            expect(toggle().getAttribute("title")).toBe("Hide right sidebar"),
        );
    });
});
