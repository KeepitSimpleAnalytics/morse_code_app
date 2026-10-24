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
const { KochScreen } = await import("../../../src/features/koch/KochScreen");
const koch = await import("../../../src/features/koch/controller");
const { useSettings } = await import("../../../src/state/settings");

beforeEach(async () => {
  plays.length = 0;
  await openTestProfile();
  koch.resetKoch();
  useSettings.getState().set("koch.lengthKind", "groups");
  useSettings.getState().set("koch.groups", 5);
});

afterEach(() => {
  koch.resetKoch();
});

describe("Koch screen", () => {
  it("runs a lesson end to end: intro, copy, score and the diff", async () => {
    const user = userEvent.setup();
    render(<KochScreen />);
    expect(await screen.findByRole("heading", { name: /Level 1/ })).toBeInTheDocument();
    expect(screen.getByLabelText("K: not practised yet")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start lesson" }));
    expect(await screen.findByText("Your first two characters")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Skip and start lesson" }));
    expect(await screen.findByRole("heading", { name: "Copy what you hear" })).toBeInTheDocument();

    const sent = koch
      .currentPromptTokens()
      .map((t) => (t.type === "char" ? t.symbol.symbol : " "))
      .join("");
    const call = plays[plays.length - 1] as PlayCall;
    act(() => {
      call.listener.onDone?.();
    });
    expect(screen.getByRole("heading", { name: "Finish typing" })).toBeInTheDocument();

    // Get the first character wrong on purpose, then score with Enter.
    const wrong = sent.startsWith("K") ? "M" : "K";
    await user.type(screen.getByLabelText("Your copy"), `${wrong}${sent.slice(1)}{Enter}`);

    expect(await screen.findByRole("heading", { name: /Lesson results/ })).toBeInTheDocument();
    expect(screen.getByText("96%")).toBeInTheDocument(); // 24 of 25
    expect(screen.getByLabelText(`${sent[0]} typed as ${wrong}`)).toBeInTheDocument();
    // A 5-group lesson is under a minute, so it doesn't count towards passing.
    expect(screen.getByText(/under a minute/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replay with text shown" })).toBeInTheDocument();
  });
});
