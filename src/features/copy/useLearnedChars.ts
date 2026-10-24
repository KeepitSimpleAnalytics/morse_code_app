import { useEffect, useState } from "react";
import { errorText, requireStore, useApp } from "../../state/app";
import { useSettings } from "../../state/settings";
import { learnedKochChars } from "../drill/modes";

interface Learned {
  readonly key: string;
  readonly chars: readonly string[] | null;
  readonly error: string | null;
}

/** The learned Koch characters, for previews. `chars` is null while loading. */
export function useLearnedChars(): { chars: readonly string[] | null; error: string | null } {
  const profileId = useApp((s) => s.current?.id);
  const order = useSettings((s) => s.values["learning.kochOrder"]);
  const key = `${profileId ?? ""}|${order}`;
  const [loaded, setLoaded] = useState<Learned | null>(null);
  useEffect(() => {
    let live = true;
    if (profileId) {
      learnedKochChars(requireStore(), profileId, useSettings.getState().values).then(
        (chars) => {
          if (live) setLoaded({ key, chars, error: null });
        },
        (err: unknown) => {
          if (live) setLoaded({ key, chars: null, error: errorText(err) });
        },
      );
    }
    return () => {
      live = false;
    };
  }, [key, profileId]);
  return loaded?.key === key ? loaded : { chars: null, error: null };
}
