import {appConfigDir, join} from "@tauri-apps/api/path";
import {exists, mkdir, readTextFile, writeTextFile,} from "@tauri-apps/plugin-fs";
import {DEFAULT_SESSION, type Session} from "../types";

const FILE = "session.json";

async function sessionPath() {
    return join(await appConfigDir(), FILE);
}

export async function loadSession(): Promise<Session> {
    try {
        const path = await sessionPath();
        if (!(await exists(path))) return DEFAULT_SESSION;
        const parsed = JSON.parse(await readTextFile(path));
        // Shallow merge so keys added in later versions pick up their defaults.
        return {
            ...DEFAULT_SESSION,
            ...parsed,
            layouts: {...DEFAULT_SESSION.layouts, ...parsed.layouts},
        };
    } catch {
        return DEFAULT_SESSION;
    }
}

export async function saveSession(session: Session): Promise<void> {
    try {
        const dir = await appConfigDir();
        await mkdir(dir, {recursive: true});
        await writeTextFile(await join(dir, FILE), JSON.stringify(session, null, 2));
    } catch (err) {
        console.error("failed to save session", err);
    }
}
