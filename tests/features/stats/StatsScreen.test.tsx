// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { openTestProfile } from "../../app/harness";
import { StatsScreen } from "../../../src/features/stats/StatsScreen";
import { drillStores } from "../../../src/features/drill/store";
import { requireProfile } from "../../../src/state/app";
import { useNavStore } from "../../../src/state/nav";
import { buildTrialRecord } from "../../../src/storage/records";

type Store = Awaited<ReturnType<typeof openTestProfile>>;
let store: Store;
let seq = 0;

async function seedSession(
  mode: "koch" | "icr",
  trials: { prompt: string; response: string; responseMs?: number }[],
): Promise<void> {
  const profileId = requireProfile().id;
  const id = `s${++seq}`;
  const now = Date.now();
  await store.startSession({ id, profileId, mode, startedAt: now, seed: 1, settingsSnapshot: {} });
  for (const [i, t] of trials.entries()) {
    await store.recordTrial(
      buildTrialRecord({
        id: `${id}-t${i}`,
        profileId,
        sessionId: id,
        mode,
        idx: i,
        prompt: t.prompt,
        response: t.response,
        revealed: false,
        repeats: 0,
        responseMs: t.responseMs ?? null,
        charWpm: 20,
        at: now + i,
      }),
    );
  }
  await store.endSession(id, { endedAt: now + 60_000, activeMs: 60_000, completed: true });
}

beforeEach(async () => {
  store = await openTestProfile();
  drillStores.groups.setState({ phase: "idle", override: null });
});

describe("Stats screen", () => {
  it("shows a new profile's empty state", async () => {
    render(<StatsScreen />);
    expect(await screen.findByText("No scored sessions yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Practise my weak characters" })).toBeDisabled();
    expect(screen.getByLabelText("K: not practised yet")).toBeInTheDocument();
  });

  it("shows the overview, what a character is heard as, and the history", async () => {
    const user = userEvent.setup();
    // 25 lessons of "HKM": H heard as S 10 times, as 5 five times.
    await seedSession(
      "koch",
      Array.from({ length: 25 }, (_, i) => ({
        prompt: "HKM",
        response: i < 10 ? "SKM" : i < 15 ? "5KM" : "HKM",
      })),
    );
    await seedSession("icr", [
      { prompt: "K", response: "K", responseMs: 400 },
      { prompt: "M", response: "M", responseMs: 600 },
    ]);
    render(<StatsScreen />);

    expect(await screen.findByText("500 ms")).toBeInTheDocument(); // ICR median
    expect(screen.getByText("2 min")).toBeInTheDocument(); // today
    // 75 + 2 sent, 15 errors.
    expect(screen.getByText(`${Math.round((1 - 15 / 77) * 100)}%`)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^H: / }));
    const detail = await screen.findByRole("region", { name: "H" });
    expect(await within(detail).findByText(/40% of the time/)).toBeInTheDocument(); // S: 10 of 25
    expect(within(detail).getByText(/20% of the time/)).toBeInTheDocument(); // 5: 5 of 25

    const history = screen.getByRole("region", { name: "Sessions" });
    expect(within(history).getByText("Koch lesson")).toBeInTheDocument();
    expect(within(history).getByText("Instant Recognition")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Practise my weak characters" }));
    expect(useNavStore.getState().screen).toBe("groups");
    expect(drillStores.groups.getState().override?.[0]).toBe("H");
  });
});
