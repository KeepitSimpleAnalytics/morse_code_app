/**
 * Production-only webview hardening (SPEC §10.1): no default context menu outside
 * text fields, and no reload shortcuts. Devtools are excluded from release builds
 * by Tauri itself (the `devtools` cargo feature is not enabled).
 */

function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  const field = target.closest("input, textarea, [contenteditable=''], [contenteditable='true']");
  if (!field) return false;
  if (field instanceof HTMLInputElement) {
    return !["button", "checkbox", "radio", "range", "submit", "reset", "color", "file"].includes(
      field.type,
    );
  }
  return true;
}

export function isReloadShortcut(event: KeyboardEvent): boolean {
  if (event.key === "F5") return true;
  return (event.ctrlKey || event.metaKey) && (event.key === "r" || event.key === "R");
}

export function installProductionGuards(target: Window): () => void {
  const onContextMenu = (event: MouseEvent) => {
    if (!isTextField(event.target)) event.preventDefault();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (isReloadShortcut(event)) event.preventDefault();
  };
  target.addEventListener("contextmenu", onContextMenu);
  target.addEventListener("keydown", onKeyDown, { capture: true });
  return () => {
    target.removeEventListener("contextmenu", onContextMenu);
    target.removeEventListener("keydown", onKeyDown, { capture: true });
  };
}
