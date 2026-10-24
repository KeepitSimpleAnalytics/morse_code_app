import cwAbbrev from "../data/cw-abbrev.json";
import prefixesData from "../data/prefixes.json";
import qcodes from "../data/qcodes.json";
import v1Common from "../data/v1-common.json";
import type { Prefix } from "./generators/callsigns";
import type { WordItem } from "./generators/words";

/** Bundled word lists and the prefix table. Sources and licenses: src/data/README.md. */

export interface BundledList {
  readonly id: WordListId;
  readonly name: string;
  readonly items: readonly WordItem[];
}

export const WORD_LIST_IDS = ["v1-common", "cw-abbrev", "qcodes"] as const;
export type WordListId = (typeof WORD_LIST_IDS)[number];

export const WORD_LISTS: readonly BundledList[] = [v1Common, cwAbbrev, qcodes].map((l) => ({
  id: l.id as WordListId,
  name: l.name,
  items: l.items,
}));

export function wordList(id: WordListId): BundledList {
  const list = WORD_LISTS.find((l) => l.id === id);
  if (!list) throw new Error(`Unknown word list: ${id}`);
  return list;
}

export const PREFIXES: readonly Prefix[] = prefixesData.items;
