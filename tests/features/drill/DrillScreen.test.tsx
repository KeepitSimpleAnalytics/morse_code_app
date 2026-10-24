// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../../../src/core/timeline";

interface PlayCall {
  elements: readonly TimelineElement[];
  listener: { onToken?: (i: number) => void; onDone?: () => void };
}

const plays: PlayCall[] = [];

vi.mock("../../../src/audio/engine", () => ({
  audioEngine: {
    start: () => Promise.resolve({ ctx: { currentTime: 0 }, keyGain: {} }),
    setFrequency: () => undefined,
    setVolume: () => undefined,
    outputLatencySec: () => 0,
  },
}));

vi.mock("../../../src/audio/scheduler", () => ({
  browserTimers: {},
  KeyingScheduler: class {
    play(elements: readonly TimelineElement[], _rise: number, listener: PlayCall["listener"]) {
      plays.push({ elements, listener });
    }
    stop = () => 0;
    pendingTokens = () => 0;
  },
}));

const { openTestProfile } = await import("../../app/harness");
const { DrillScreen } = await import("../../../src/features/drill/DrillScreen");
const drill = await import("../../../src/features/drill/controller");
const { drillStores } = await import("../../../src/features/drill/store");
const { useSettings } = await import("../../../src/state/settings");

const lastPlay = () => plays[plays.length - 1] as PlayCall;

beforeEach(async () => {
  plays.length = 0;
  await openTestProfile();
  drill.resetDrills();
  useSettings.getState().set("words.items", 5);
});

afterEach(() => {
  drill.resetDrills();
});

describe("drill screens", () => {
  it("Words: answer with Enter, see the meaning, go on, stop and see the results", async () => {
    const user = userEvent.setup();
    useSettings.getState().set("words.list", "qcodes");
    render(<DrillScreen mode="words" />);
    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByRole("heading", { name: "Copy what you hear" })).toBeInTheDocument();
    expect(screen.getByText("Item 1 of 5")).toBeInTheDocument();

    const item = drillStores.words.getState().item;
    act(() => {
      lastPlay().listener.onDone?.();
    });
    await user.type(screen.getByLabelText("Your answer"), `${item?.text ?? ""}{Enter}`);
    expect(await screen.findByRole("heading", { name: "Correct" })).toBeInTheDocument();
    expect(screen.getAllByText(item?.meaning ?? "").length).toBeGreaterThan(0);

    // The Next button has focus, so Enter moves on.
    await user.keyboard("{Enter}");
    expect(await screen.findByText("2 / 5")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(await screen.findByRole("heading", { name: "Results" })).toBeInTheDocument();
    expect(screen.getByText(/Stopped after 1 of 5 items/)).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("Random Groups shows the practice override and clears it", async () => {
    const user = userEvent.setup();
    drill.setOverride(["H", "5"]);
    render(<DrillScreen mode="groups" />);
    expect(screen.getByText("H 5")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Use my character set" }));
    expect(screen.getByRole("radiogroup", { name: "Character source" })).toBeInTheDocument();
  });

  it("Random Groups disables Start with fewer than two characters", async () => {
    const user = userEvent.setup();
    render(<DrillScreen mode="groups" />);
    await user.click(screen.getByRole("button", { name: "Letters" }));
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    expect(screen.getByText("Choose at least two characters.")).toBeInTheDocument();
  });

  it("Custom counts its items as you type", async () => {
    const user = userEvent.setup();
    render(<DrillScreen mode="custom" />);
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
    await user.type(screen.getByLabelText("Your text"), "cq cq{Enter}de w1abc");
    expect(screen.getByText(/2 items, played in order/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeEnabled();
  });

  it("Words: the learned-only filter blocks Start when nothing fits", async () => {
    const user = userEvent.setup();
    render(<DrillScreen mode="words" />);
    await user.click(screen.getByRole("button", { name: "Only learned Koch characters" }));
    expect(await screen.findByText(/0 of 40 words available/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  });
});
