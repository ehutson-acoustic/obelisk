// @vitest-environment jsdom
import {act, cleanup, render, screen, waitFor} from "@testing-library/react";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import type {DefaultEditorState} from "../lib/associations";

/**
 * The row is the only UI that writes to the OS, and its states are what the user
 * reads to decide whether anything happened — so each branch is asserted rather
 * than left to a look at the dialog.
 */

const IDLE: DefaultEditorState = {
    supported: true,
    default: false,
    current: "com.example.other-editor",
    blocked: null,
};

let state: DefaultEditorState = IDLE;
/** State the claim resolves to, or an error to reject with. */
let afterClaim: DefaultEditorState | Error = {...IDLE, default: true, current: null};
let claims = 0;

vi.mock("@tauri-apps/api/core", () => ({
    invoke: async (cmd: string) => {
        if (cmd === "default_editor_state") return state;
        if (cmd === "set_default_editor") {
            claims += 1;
            if (afterClaim instanceof Error) throw afterClaim;
            return afterClaim;
        }
        return null;
    },
}));

async function mountRow() {
    const {DefaultEditorSetting} = await import("./DefaultEditorSetting");
    render(<DefaultEditorSetting/>);
}

const button = () => screen.getByRole("button", {name: /Make Obelisk the default/});

beforeEach(() => {
    state = IDLE;
    afterClaim = {...IDLE, default: true, current: null};
    claims = 0;
});

afterEach(cleanup);

describe("DefaultEditorSetting", () => {
    it("offers the button and names the incumbent handler", async () => {
        await mountRow();

        await waitFor(() => expect(button().hasAttribute("disabled")).toBe(false));
        expect(screen.getByText("com.example.other-editor")).toBeTruthy();
    });

    it("reports the settled state after a successful claim", async () => {
        await mountRow();
        await waitFor(() => expect(button().hasAttribute("disabled")).toBe(false));

        await act(async () => button().click());

        expect(claims).toBe(1);
        // The button is gone, which is the point: there is nothing left to press.
        expect(screen.queryByRole("button")).toBeNull();
        expect(screen.getByText(/Obelisk opens/)).toBeTruthy();
    });

    it("shows the reason the OS gave when the claim fails", async () => {
        afterClaim = new Error("macOS refused the change (OSStatus -10814).");
        await mountRow();
        await waitFor(() => expect(button().hasAttribute("disabled")).toBe(false));

        await act(async () => button().click());

        expect(screen.getByText(/OSStatus -10814/)).toBeTruthy();
        // Still offered, because the state the OS reported has not changed.
        expect(button().hasAttribute("disabled")).toBe(false);
    });

    it("disables the button and explains itself when the platform blocks it", async () => {
        state = {
            ...IDLE,
            blocked: "No Obelisk desktop entry is installed.",
        };
        await mountRow();

        await waitFor(() =>
            expect(button().hasAttribute("disabled")).toBe(true),
        );
        expect(screen.getByText("No Obelisk desktop entry is installed.")).toBeTruthy();
        expect(claims).toBe(0);
    });
});
