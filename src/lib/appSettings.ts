import {appConfigDir, join} from "@tauri-apps/api/path";
import {exists, mkdir, readTextFile, writeTextFile,} from "@tauri-apps/plugin-fs";
import {DEFAULT_EDITOR_SETTINGS, type EditorSettings,} from "./editorSettings";

/**
 * App-level defaults, separate from session.json (which holds window state).
 * DESIGN §5.2: appearance is deliberately app-only — a per-project setting
 * would flip the whole UI between light and dark as you switch projects.
 */
export type Appearance = "light" | "dark" | "system";

export type AppSettings = {
    appearance: Appearance;
    /** Defaults a project may override (DESIGN §5.2). */
    editor: EditorSettings;
};

export const DEFAULT_APP_SETTINGS: AppSettings = {
    appearance: "system",
    editor: DEFAULT_EDITOR_SETTINGS,
};

const FILE = "settings.json";

export async function loadAppSettings(): Promise<AppSettings> {
    try {
        const path = await join(await appConfigDir(), FILE);
        if (!(await exists(path))) return DEFAULT_APP_SETTINGS;
        const parsed = JSON.parse(await readTextFile(path));
        // Merge one level down so keys added in later versions pick up defaults.
        return {
            ...DEFAULT_APP_SETTINGS,
            ...parsed,
            editor: {...DEFAULT_EDITOR_SETTINGS, ...parsed.editor},
        };
    } catch {
        return DEFAULT_APP_SETTINGS;
    }
}

export async function saveAppSettings(settings: AppSettings): Promise<void> {
    try {
        const dir = await appConfigDir();
        await mkdir(dir, {recursive: true});
        await writeTextFile(
            await join(dir, FILE),
            JSON.stringify(settings, null, 2),
        );
    } catch (err) {
        console.error("failed to save app settings", err);
    }
}
