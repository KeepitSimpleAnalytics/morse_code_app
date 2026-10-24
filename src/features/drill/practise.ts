import { useNavStore } from "../../state/nav";
import { useSettings } from "../../state/settings";
import { CUSTOM_TEXT_MAX, type Weighting } from "../../state/settings-schema";
import * as drill from "./controller";
import { drillStores } from "./store";

/** Jumps into a practice mode from elsewhere in the app. */

/**
 * "Practice these characters": Random Groups on just these, until cleared,
 * with `weighting` in place of the saved one if given (Stats' "Practise my weak
 * characters" is always adaptive, §7.10). Refused, with a notice, while a
 * Groups session is under way.
 */
export function practiseChars(
  chars: readonly string[],
  weighting: Weighting | null = null,
): boolean {
  const applied = drill.setOverride({ chars, weighting });
  if (!applied) {
    drillStores.groups.getState().set({
      notice: `Finish or stop this Random Groups session first, then practise ${chars.join(" ")} again.`,
    });
  }
  useNavStore.getState().go("groups");
  return applied;
}

export type CustomLoad = "loaded" | "busy" | "tooLong";

/**
 * A Text Player snippet → Custom Practice. Refused while a Custom session is
 * running, so its text can't change underneath it, and for text over the
 * Custom limit, which is never cut short.
 */
export function practiseInCustom(text: string, title: string): CustomLoad {
  const custom = drillStores.custom.getState();
  if (drill.sessionInProgress("custom")) {
    custom.set({
      notice: "Finish or stop the current Custom session first, then load the snippet again.",
    });
    useNavStore.getState().go("custom");
    return "busy";
  }
  if (text.length > CUSTOM_TEXT_MAX) {
    return "tooLong";
  }
  drill.dismissResults("custom");
  useSettings.getState().set("custom.text", text);
  custom.set({ notice: `Loaded “${title}”.`, error: null });
  useNavStore.getState().go("custom");
  return "loaded";
}
