import { useEffect } from "react";
import { create } from "zustand";

/** Whether the keyboard shortcut overlay (SPEC §10.3) is open, and the `?` key that opens it. */

export const useShortcutsStore = create<{ open: boolean; setOpen: (open: boolean) => void }>()(
  (set) => ({
    open: false,
    setOpen: (open) => {
      set({ open });
    },
  }),
);

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement && target.type !== "range" && target.type !== "checkbox")
  );
}

/** `?` opens the overlay, unless the user is typing or a screen already used the key. */
export function useShortcutsKey(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target) || document.querySelector('[role="dialog"]')) return;
      e.preventDefault();
      useShortcutsStore.getState().setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, []);
}
