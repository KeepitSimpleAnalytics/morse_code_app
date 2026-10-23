import { isTauri } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import { wavFilename } from "../../core/wav";

export type ExportResult = { kind: "saved"; path: string } | { kind: "cancelled" };

/**
 * Asks where to save, then writes the WAV. The dialog plugin adds the chosen path
 * to the fs scope, so no broader write permission is needed.
 */
export async function saveWav(text: string, bytes: Uint8Array): Promise<ExportResult> {
  if (!isTauri()) {
    throw new Error("WAV export needs the desktop app (it isn't available in a plain browser)");
  }
  const path = await save({
    title: "Export Morse audio",
    defaultPath: wavFilename(text),
    filters: [{ name: "WAV audio", extensions: ["wav"] }],
  });
  if (path === null) return { kind: "cancelled" };
  await writeFile(path, bytes);
  return { kind: "saved", path };
}
