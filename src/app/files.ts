import { isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

/**
 * Text file save/open. The desktop app uses native dialogs (the dialog plugin adds
 * the chosen path to the fs scope). `pnpm dev:web` falls back to a browser
 * download and file picker, so export/import can be exercised without Tauri.
 */

interface FileFilter {
  name: string;
  extensions: string[];
}

/** Returns the saved path (or file name in a browser), or null if cancelled. */
export async function saveTextFile(
  title: string,
  defaultName: string,
  text: string,
  filter: FileFilter,
): Promise<string | null> {
  if (isTauri()) {
    const path = await save({ title, defaultPath: defaultName, filters: [filter] });
    if (path === null) return null;
    await writeTextFile(path, text);
    return path;
  }
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = defaultName;
  a.click();
  URL.revokeObjectURL(url);
  return defaultName;
}

/** Returns the file's text, or null if cancelled. */
export async function openTextFile(title: string, filter: FileFilter): Promise<string | null> {
  if (isTauri()) {
    const path = await open({ title, multiple: false, directory: false, filters: [filter] });
    if (path === null) return null;
    return readTextFile(path);
  }
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = filter.extensions.map((e) => `.${e}`).join(",");
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      file.text().then(resolve, reject);
    });
    input.addEventListener("cancel", () => {
      resolve(null);
    });
    input.click();
  });
}
