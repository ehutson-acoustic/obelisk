import {invoke} from "@tauri-apps/api/core";

/** Enumerating fonts shells out, so it's done once and shared. */
let cached: Promise<string[]> | null = null;

export function systemFonts(): Promise<string[]> {
    cached ??= invoke<string[]>("system_fonts").catch(() => []);
    return cached;
}

/** A full CSS stack is unreadable in a dropdown; its first family names it. */
export function familyLabel(value: string): string {
    if (!value || value === "inherit") return "Inherit";
    return value.split(",")[0].replace(/["']/g, "").trim();
}
