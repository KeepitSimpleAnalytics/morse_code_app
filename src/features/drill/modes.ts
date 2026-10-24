import { PREFIXES, wordList } from "../../core/bundled";
import { charsetFromClasses, MIN_CHARSET, parseCustomCharset } from "../../core/charset";
import { chunkText } from "../../core/chunk";
import { generateCallsigns } from "../../core/generators/callsigns";
import { generateGroups } from "../../core/generators/groups";
import { generateWords, wordsUsing } from "../../core/generators/words";
import { kochChars, kochOrder, maxKochLevel } from "../../core/koch";
import type { Rng } from "../../core/rng";
import type { SettingsValues } from "../../state/settings-schema";
import type { Store } from "../../storage/store";
import { loadWeights } from "../copy/weights";
import type { DrillItem, DrillMode, PractiseOverride } from "./store";

/** What each per-item mode plays (SPEC §7.3–7.7). */

/** A reason a session can't start, worded for the user. */
export class SetupError extends Error {}

export interface PlanInput {
  readonly mode: DrillMode;
  readonly v: SettingsValues;
  readonly rng: Rng;
  readonly store: Store;
  readonly profileId: string;
  /** Random Groups: "Practice these characters". */
  readonly override: PractiseOverride | null;
}

export interface DrillPlan {
  readonly items: DrillItem[];
  /** Mode settings for the session snapshot. */
  readonly snapshot: Record<string, unknown>;
  /** Shown to the user when the session starts, e.g. characters left out. */
  readonly notice: string | null;
}

/** The learned characters of the profile's current Koch order and level. */
export async function learnedKochChars(
  store: Store,
  profileId: string,
  v: SettingsValues,
): Promise<readonly string[]> {
  const order = kochOrder(v["learning.kochOrder"]);
  const saved =
    (await store.getKochProgress(profileId)).find((p) => p.orderId === order.id)?.level ?? 1;
  return kochChars(order, Math.min(saved, maxKochLevel(order)));
}

/** Random Groups' character set, before any "Practice these characters" override. */
export async function groupChars(
  store: Store,
  profileId: string,
  v: SettingsValues,
): Promise<readonly string[]> {
  switch (v["groups.source"]) {
    case "classes":
      return charsetFromClasses({
        letters: v["groups.letters"],
        digits: v["groups.digits"],
        punct: v["groups.punct"],
        prosigns: v["groups.prosigns"],
      });
    case "custom":
      return parseCustomCharset(v["groups.custom"]).chars;
    case "koch":
      return learnedKochChars(store, profileId, v);
  }
}

async function planGroups({ v, rng, store, profileId, override }: PlanInput): Promise<DrillPlan> {
  const chars = override?.chars ?? (await groupChars(store, profileId, v));
  if (chars.length < MIN_CHARSET) throw new SetupError("Choose at least two characters.");
  const weighting = override?.weighting ?? v["groups.weighting"];
  const weights =
    weighting === "adaptive" ? await loadWeights(store, profileId, chars, "copy") : undefined;
  const groups = generateGroups({
    rng,
    allowedChars: chars,
    count: v["groups.items"],
    length: { kind: "fixed", length: v["groups.length"] },
    ...(weights ? { weights } : {}),
  });
  return {
    items: groups.map((text) => ({ text })),
    snapshot: {
      chars: [...chars],
      source: override ? "practise" : v["groups.source"],
      groupLength: v["groups.length"],
      weighting,
    },
    notice: null,
  };
}

async function planWords({ v, rng, store, profileId }: PlanInput): Promise<DrillPlan> {
  const list = wordList(v["words.list"]);
  const allowed = v["words.learnedOnly"] ? await learnedKochChars(store, profileId, v) : undefined;
  if (wordsUsing(list.items, allowed).length === 0) {
    throw new SetupError(`No words in ${list.name} use only your learned Koch characters yet.`);
  }
  const words = generateWords({
    rng,
    items: list.items,
    count: v["words.items"],
    ...(allowed ? { allowedChars: allowed } : {}),
  });
  return {
    items: words.map((w) => ({ text: w.word, ...(w.meaning ? { meaning: w.meaning } : {}) })),
    snapshot: { list: list.id, learnedOnly: v["words.learnedOnly"] },
    notice: null,
  };
}

function planCallsigns({ v, rng }: PlanInput): DrillPlan {
  const calls = generateCallsigns({
    rng,
    prefixes: PREFIXES,
    formats: v["callsigns.formats"],
    usOnly: v["callsigns.usOnly"],
    count: v["callsigns.items"],
  });
  return {
    items: calls.map((text) => ({ text })),
    snapshot: { formats: v["callsigns.formats"], usOnly: v["callsigns.usOnly"] },
    notice: null,
  };
}

function planCustom({ v }: PlanInput): DrillPlan {
  const split =
    v["custom.split"] === "line"
      ? ({ kind: "line" } as const)
      : ({ kind: "words", perItem: v["custom.wordsPerItem"] } as const);
  const { items, unsupported } = chunkText(v["custom.text"], split);
  if (items.length === 0) throw new SetupError("Paste some text to practise first.");
  return {
    items: items.map((text) => ({ text })),
    snapshot: { split },
    notice:
      unsupported.length > 0
        ? `Left out characters that have no Morse code: ${unsupported.join(" ")}`
        : null,
  };
}

export async function planDrill(input: PlanInput): Promise<DrillPlan> {
  switch (input.mode) {
    case "groups":
      return planGroups(input);
    case "words":
      return planWords(input);
    case "callsigns":
      return planCallsigns(input);
    case "custom":
      return planCustom(input);
  }
}
