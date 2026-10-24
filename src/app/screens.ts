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
  /** SPEC §15 phase that delivers the screen. */
  phase: number;
  summary: string;
  highlights: readonly [string, string, string];
}

// Sidebar order and grouping follow SPEC §10.1, minus QSO and Sending (dropped, §15.1).
export const SCREENS: readonly ScreenDef[] = [
  {
    id: "koch",
    group: "Learn",
    label: "Koch",
    title: "Koch Lessons",
    icon: BookOpenText,
    phase: 4,
    summary:
      "Learn two characters at full speed, then add one at a time. Lessons are timed and scored character by character, and you advance when you pass.",
    highlights: [
      "LCWO, G4FON and Classic (v1) orders",
      "Copy-as-you-go lessons with an aligned diff",
      "Each new character introduced by sound and rhythm",
    ],
  },
  {
    id: "icr",
    group: "Learn",
    label: "Instant Recognition",
    title: "Instant Character Recognition",
    icon: Zap,
    phase: 6,
    summary:
      "One character, one keypress, no thinking. Builds the reflex that turns sound straight into letters.",
    highlights: [
      "Response-time tracking per character",
      "Adaptive timeout that follows your median",
      "Weak characters come back more often",
    ],
  },
  {
    id: "groups",
    group: "Practice",
    label: "Random Groups",
    title: "Random Groups",
    icon: Shuffle,
    phase: 5,
    summary:
      "Random groups from any character set: letters, digits, punctuation, prosigns or your own.",
    highlights: [
      "Pick the characters and the group length",
      "Limit to your learned Koch characters",
      "Uniform or adaptive weighting",
    ],
  },
  {
    id: "words",
    group: "Practice",
    label: "Words",
    title: "Words",
    icon: TypeOutline,
    phase: 5,
    summary:
      "v1's common words, CW abbreviations and Q-codes, each with its meaning shown after you answer.",
    highlights: [
      "The 40 common words from v1",
      "80+ CW abbreviations and 40+ Q-codes",
      "Use only words made of learned characters",
    ],
  },
  {
    id: "callsigns",
    group: "Practice",
    label: "Callsigns",
    title: "Callsigns",
    icon: RadioTower,
    phase: 5,
    summary: "Realistic callsigns from around the world, or US calls only as in v1.",
    highlights: ["150+ weighted prefixes", "1×1 to 2×3 formats", "A US-only option"],
  },
  {
    id: "custom",
    group: "Practice",
    label: "Custom",
    title: "Custom Practice",
    icon: NotebookPen,
    phase: 5,
    summary:
      "Practise with your own text: paste it in and copy it back, a line or a few words at a time.",
    highlights: [
      "Split by line or every N words",
      "Played in order, one item at a time",
      "Scored character by character",
    ],
  },
  {
    id: "player",
    group: "Tools",
    label: "Text Player",
    title: "Text Player",
    icon: AudioWaveform,
    phase: 2,
    summary:
      "Type anything and hear it in Morse. The character that's sounding is highlighted in both the text and the code.",
    highlights: [
      "Play from the cursor, loop, type-to-transmit",
      "Reverse-decode pasted dots and dashes",
      "Export the audio as a WAV file",
    ],
  },
  {
    id: "stats",
    group: "Progress",
    label: "Stats",
    title: "Stats",
    icon: ChartColumn,
    phase: 7,
    summary:
      "See every character you've learned: what you hear well, what you mix up, and your past sessions.",
    highlights: [
      "Character grid with what each one is confused with",
      "Session history with scores",
      "Practise your weakest characters in one click",
    ],
  },
  {
    id: "settings",
    group: "System",
    label: "Settings",
    title: "Settings",
    icon: Settings,
    phase: 3,
    summary:
      "Timing, audio, display, learning and data. Progress is saved locally and backed up daily.",
    highlights: [
      "Character and Farnsworth speed, kept linked",
      "Export, import and restore from backup",
      "Import your v1 progress",
    ],
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
