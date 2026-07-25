import { join } from "@tauri-apps/api/path";
import { exists, readTextFile } from "@tauri-apps/plugin-fs";

/**
 * DESIGN §5.2 — project settings are stored sparsely, so every field is
 * optional and an absent key means "inherit the app default". The settings UI
 * is P4; this loader exists now because the terminal needs the startup command.
 */
export type ProjectSettings = {
  terminalStartupCommand?: string;
  checkpointIntervalMinutes?: number;
  theme?: string;
};

export async function loadProjectSettings(
  dir: string,
): Promise<ProjectSettings> {
  try {
    const path = await join(dir, ".mdeditor", "settings.json");
    if (!(await exists(path))) return {};
    const parsed = JSON.parse(await readTextFile(path));
    return typeof parsed === "object" && parsed ? parsed : {};
  } catch {
    return {};
  }
}
