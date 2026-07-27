import {join} from "@tauri-apps/api/path";
import {exists, mkdir, readTextFile, writeTextFile,} from "@tauri-apps/plugin-fs";
import type {ProjectOverrides} from "./editorSettings";

/**
 * DESIGN §5.1/§5.2 — `.obelisk/settings.json`, stored sparsely so absent keys
 * inherit the app default. Only `.obelisk/git/` is gitignored, so this file
 * stays committable and project styling can be shared.
 */

async function settingsPath(dir: string) {
    return join(dir, ".obelisk", "settings.json");
}

export async function loadProjectSettings(
    dir: string,
): Promise<ProjectOverrides> {
    try {
        const path = await settingsPath(dir);
        if (!(await exists(path))) return {};
        const parsed = JSON.parse(await readTextFile(path));
        return typeof parsed === "object" && parsed ? parsed : {};
    } catch {
        return {};
    }
}

export async function saveProjectSettings(
    dir: string,
    overrides: ProjectOverrides,
): Promise<void> {
    const path = await settingsPath(dir);
    await mkdir(await join(dir, ".obelisk"), {recursive: true});
    await writeTextFile(path, `${JSON.stringify(overrides, null, 2)}\n`);
}
