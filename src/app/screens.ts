import type { LucideIcon } from "lucide-react";
import {
  AudioWaveform,
  ChartColumn,
  BookOpenText,
  Keyboard,
  NotebookPen,
  Radio,
  RadioTower,
  Settings,
  Shuffle,
  TypeOutline,
  Zap,
} from "lucide-react";

export type ScreenId =
  | "koch"
  | "icr"
  | "groups"
  | "words"
  | "callsigns"
  | "qso"
  | "custom"
  | "player"
  | "sending"
  | "stats"
  | "settings";

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

// Sidebar order and grouping follow SPEC §10.1 exactly.
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
      "Fixed or random group length",
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
      "Common English words, CW abbreviations and Q-codes, each with its meaning shown after you answer.",
    highlights: [
      "Top-100 and top-500 word lists",
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
    summary: "Realistic callsigns from around the world, with portable and prefix-slash forms.",
    highlights: [
      "150+ weighted prefixes",
      "/P, /M, /QRP and VE3/W1ABC forms",
      "Import MASTER.SCP to use real calls",
    ],
  },
  {
    id: "qso",
    group: "Practice",
    label: "QSO",
    title: "QSO Simulation",
    icon: Radio,
    phase: 9,
    summary: "Copy a whole contact, then fill in the log. Name, QTH, RST and rig are each scored.",
    highlights: [
      "Ragchew, contest and POTA/SOTA styles",
      "Per-field scoring plus a full diff",
      "Optional noise, QSB and QRM",
    ],
  },
  {
    id: "custom",
    group: "Practice",
    label: "Custom",
    title: "Custom Practice",
    icon: NotebookPen,
    phase: 5,
    summary:
      "Practise with your own text: paste it, import a .txt file, or send a Text Player snippet here.",
    highlights: [
      "Split by sentence, by line or every N words",
      "Sequential or shuffled order",
      "Per item or streamed, scored the same way",
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
    id: "sending",
    group: "Tools",
    label: "Sending",
    title: "Sending Practice",
    icon: Keyboard,
    phase: 8,
    summary:
      "Send with the keyboard or a USB paddle adapter. A live decoder shows how your timing really sounds.",
    highlights: [
      "Straight key, Iambic A and Iambic B",
      "Dit/dah histogram and spacing analysis",
      "Left/Right Ctrl paddles work with no drivers",
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
      "See every character you've learned: what you hear well, what you mix up, and how far you've come.",
    highlights: [
      "Character grid and confusion matrix",
      "Streaks, calendar and trends",
      "Replay any past session exactly",
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
      "Timing, audio, display, learning, keys and data. Progress is saved locally and backed up daily.",
    highlights: [
      "Character and Farnsworth speed, kept linked",
      "Export, import and restore from backup",
      "Import your v1 progress",
    ],
  },
];

/** Ctrl/Cmd+1…9 jump to the first nine modes (SPEC §10.3). */
export const SHORTCUT_SCREENS: readonly ScreenId[] = SCREENS.slice(0, 9).map((s) => s.id);

export function screenById(id: ScreenId): ScreenDef {
  const screen = SCREENS.find((s) => s.id === id);
  if (!screen) throw new Error(`Unknown screen: ${id}`);
  return screen;
}

export function shortcutIndex(id: ScreenId): number | null {
  const i = SHORTCUT_SCREENS.indexOf(id);
  return i === -1 ? null : i + 1;
}
