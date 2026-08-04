import {invoke} from "@tauri-apps/api/core";

/** Mirrors `DefaultEditorState` in `src-tauri/src/associations.rs`. */
export type DefaultEditorState = {
    /** Whether this platform can be asked at all. */
    supported: boolean;
    /** Obelisk currently holds the binding. */
    default: boolean;
    /** What holds it instead: a bundle id on macOS, a desktop entry on Linux. */
    current: string | null;
    /** Why the button cannot work right now. */
    blocked: string | null;
};

export const defaultEditorState = () =>
    invoke<DefaultEditorState>("default_editor_state");

/** Resolves to the state that resulted, which is not always the one asked for. */
export const setDefaultEditor = () =>
    invoke<DefaultEditorState>("set_default_editor");
