import {invoke} from "@tauri-apps/api/core";
import {listen, type UnlistenFn} from "@tauri-apps/api/event";

/** Twin of `OPEN_FILES_EVENT` in `src-tauri/src/lib.rs`. */
const OPEN_FILES_EVENT = "obelisk://open-files";

/**
 * Files the OS asked for before the webview existed (DESIGN §10.1).
 *
 * Draining is also what tells Rust the frontend is up, so anything arriving from
 * here on comes through `onOpenRequest` instead. Call it *after* subscribing.
 */
export async function takeOpenRequests(): Promise<string[]> {
    return invoke("take_open_requests");
}

/** Directory to adopt as the project for a file opened from outside the app. */
export async function projectDirFor(file: string): Promise<string | null> {
    return invoke("project_dir_for", {file});
}

export async function onOpenRequest(
    handler: (paths: string[]) => void,
): Promise<UnlistenFn> {
    return listen<string[]>(OPEN_FILES_EVENT, (event) => handler(event.payload));
}
