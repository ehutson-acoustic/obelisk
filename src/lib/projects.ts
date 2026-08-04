import type {Project} from "../types";
import {basename} from "./files";

/** Card colours, assigned round-robin as projects are added. */
export const SWATCHES = [
    "#2f6f4e",
    "#1f4e79",
    "#6b3fa0",
    "#a03f3f",
    "#b5761f",
    "#3f6b6b",
    "#7a5230",
    "#43474e",
];

/** Trailing separators would defeat the boundary check below. */
function normalize(dir: string): string {
    return dir.replace(/[/\\]+$/, "");
}

/**
 * The project a path belongs to, or null when no configured project contains it.
 *
 * The *longest* match wins: one project's directory is often a subdirectory of
 * another's, and the nearer one is the one whose settings and repo apply. The
 * separator in the prefix test is what keeps `/work/notes-old/a.md` out of a
 * project rooted at `/work/notes`.
 */
export function projectFor(path: string, projects: Project[]): Project | null {
    let best: Project | null = null;
    for (const project of projects) {
        const dir = normalize(project.dir);
        if (path !== dir && !path.startsWith(`${dir}/`)) continue;
        if (!best || dir.length > normalize(best.dir).length) best = project;
    }
    return best;
}

/**
 * A project for a directory the user never added by hand — the fallback when a
 * file arrives from the OS with nothing configured to hold it (DESIGN §10.1).
 */
export function newProject(dir: string, count: number): Project {
    const normalized = normalize(dir);
    return {
        id: crypto.randomUUID(),
        name: basename(normalized) || normalized,
        color: SWATCHES[count % SWATCHES.length],
        dir: normalized,
    };
}
