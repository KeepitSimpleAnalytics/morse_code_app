import type { LucideIcon } from "lucide-react";
import {
  AudioWaveform,
  ChartColumn,
  BookOpenText,
  NotebookPen,
  RadioTower,
  Settings,
  Shuffle,
  TypeOutline,
  Zap,
} from "lucide-react";

export type ScreenId =
  "koch" | "icr" | "groups" | "words" | "callsigns" | "custom" | "player" | "stats" | "settings";

export type ScreenGroup = "Learn" | "Practice" | "Tools" | "Progress" | "System";

export interface ScreenDef {
  id: ScreenId;
  group: ScreenGroup;
  /** Sidebar label. */
  label: string;
  /** Page heading. */
  title: string;
  icon: LucideIcon;
}

// Sidebar order and grouping follow SPEC §10.1, minus QSO and Sending (dropped, §15.1).
export const SCREENS: readonly ScreenDef[] = [
  {
    id: "koch",
    group: "Learn",
    label: "Koch",
    title: "Koch Lessons",
    icon: BookOpenText,
  },
  {
    id: "icr",
    group: "Learn",
    label: "Instant Recognition",
    title: "Instant Character Recognition",
    icon: Zap,
  },
  {
    id: "groups",
    group: "Practice",
    label: "Random Groups",
    title: "Random Groups",
    icon: Shuffle,
  },
  {
    id: "words",
    group: "Practice",
    label: "Words",
    title: "Words",
    icon: TypeOutline,
  },
  {
    id: "callsigns",
    group: "Practice",
    label: "Callsigns",
    title: "Callsigns",
    icon: RadioTower,
  },
  {
    id: "custom",
    group: "Practice",
    label: "Custom",
    title: "Custom Practice",
    icon: NotebookPen,
  },
  {
    id: "player",
    group: "Tools",
    label: "Text Player",
    title: "Text Player",
    icon: AudioWaveform,
  },
  {
    id: "stats",
    group: "Progress",
    label: "Stats",
    title: "Stats",
    icon: ChartColumn,
  },
  {
    id: "settings",
    group: "System",
    label: "Settings",
    title: "Settings",
    icon: Settings,
  },
];

/** Ctrl/Cmd+1…9 jump to the modes, in sidebar order (SPEC §10.3). Settings isn't a mode. */
export const SHORTCUT_SCREENS: readonly ScreenId[] = SCREENS.filter((s) => s.group !== "System")
  .slice(0, 9)
  .map((s) => s.id);

export function screenById(id: ScreenId): ScreenDef {
  const screen = SCREENS.find((s) => s.id === id);
  if (!screen) throw new Error(`Unknown screen: ${id}`);
  return screen;
}

export function shortcutIndex(id: ScreenId): number | null {
  const i = SHORTCUT_SCREENS.indexOf(id);
  return i === -1 ? null : i + 1;
}
