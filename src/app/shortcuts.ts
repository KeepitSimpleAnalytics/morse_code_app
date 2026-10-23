import { SHORTCUT_SCREENS, type ScreenId } from "./screens";

export const IS_MAC =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Ctrl on Windows/Linux, Cmd on macOS (SPEC §10.3). */
export function hasPrimaryModifier(event: KeyboardEvent): boolean {
  return IS_MAC ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

export const PRIMARY_MODIFIER_LABEL = IS_MAC ? "⌘" : "Ctrl";

/** Maps Ctrl/Cmd+1…9 to a screen, or null if the event isn't a navigation shortcut. */
export function screenForShortcut(event: KeyboardEvent): ScreenId | null {
  if (!hasPrimaryModifier(event) || event.altKey || event.shiftKey) return null;
  const match = /^Digit([1-9])$/.exec(event.code);
  if (!match) return null;
  return SHORTCUT_SCREENS[Number(match[1]) - 1] ?? null;
}
