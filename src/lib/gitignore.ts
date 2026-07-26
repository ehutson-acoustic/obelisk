import {join} from "@tauri-apps/api/path";
import {exists, readTextFile, writeTextFile} from "@tauri-apps/plugin-fs";

/**
 * DESIGN §5.4 — only `.mdeditor/git/` is ignored, so `settings.json` stays
 * committable and project theming can be shared. Never written without asking.
 */
const ENTRY = ".mdeditor/git/";
const BLOCK = `\n# md-editor checkpoint history\n${ENTRY}\n`;

/** True when the project is a real repo whose .gitignore lacks the entry. */
export async function needsGitignoreEntry(projectDir: string): Promise<boolean> {
    try {
        if (!(await exists(await join(projectDir, ".git")))) return false;
        const path = await join(projectDir, ".gitignore");
        if (!(await exists(path))) return true;
        const text = await readTextFile(path);
        return !/^\s*\.mdeditor\/(git\/?)?\s*$/m.test(text);
    } catch {
        return false;
    }
}

export async function addGitignoreEntry(projectDir: string): Promise<void> {
    const path = await join(projectDir, ".gitignore");
    const current = (await exists(path)) ? await readTextFile(path) : "";
    const separator = current && !current.endsWith("\n") ? "\n" : "";
    await writeTextFile(path, `${current}${separator}${BLOCK}`);
}
