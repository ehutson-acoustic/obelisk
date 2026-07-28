import {join} from "@tauri-apps/api/path";
import {mkdir, readDir, readTextFile, writeTextFile} from "@tauri-apps/plugin-fs";
import type {FileNode} from "../types";

const MARKDOWN = /\.(md|markdown|mdx)$/i;

export function isMarkdown(path: string): boolean {
    return MARKDOWN.test(path);
}

export function basename(path: string): string {
    return path.split(/[/\\]/).pop() ?? path;
}

export function dirname(path: string): string {
    const parts = path.split(/[/\\]/);
    parts.pop();
    return parts.join("/");
}

/**
 * One level only — the browser loads children lazily as folders are expanded.
 *
 * Nothing is filtered out, dot-entries included: `.claude/`, `.github/` and
 * `.obelisk/settings.json` are all files you come here to edit, and DESIGN §1.3 already rules
 * that nothing in the app treats dot-directories as hidden.
 */
export async function listDir(dir: string): Promise<FileNode[]> {
    const entries = await readDir(dir);
    const nodes = await Promise.all(
        entries.map(async (e) => ({
            name: e.name,
            path: await join(dir, e.name),
            isDir: e.isDirectory,
        })),
    );
    return nodes.sort((a, b) =>
        a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1,
    );
}

export async function readFile(path: string): Promise<string> {
    return readTextFile(path);
}

export async function writeFile(path: string, content: string): Promise<void> {
    await writeTextFile(path, content);
}

export async function createFile(dir: string, name: string): Promise<string> {
    const path = await join(dir, name);
    await writeTextFile(path, "");
    return path;
}

export async function createFolder(dir: string, name: string): Promise<string> {
    const path = await join(dir, name);
    await mkdir(path, {recursive: true});
    return path;
}
