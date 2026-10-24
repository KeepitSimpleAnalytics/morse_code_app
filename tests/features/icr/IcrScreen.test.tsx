// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../../../src/core/timeline";

vi.mock("../../../src/audio/engine", () => ({
  audioEngine: {
    start: () => Promise.resolve({ ctx: { currentTime: 0 }, keyGain: {} }),
    setFrequency: () => undefined,
    setVolume: () => undefined,
    outputLatencySec: () => 0,
    // The sound ends 200 ms after it starts. jsdom's event timeStamps may not be on
    // the performance clock, so the times shown here mean nothing; the controller
    // tests cover timing.
    heardAt: () => ({ ms: performance.now() + 50, source: "output-timestamp" }),
    tick: () => undefined,
  },
}));

vi.mock("../../../src/audio/scheduler", () => ({
  browserTimers: {},
  KeyingScheduler: class {
    last: readonly TimelineElement[] = [];
    play(elements: readonly TimelineElement[]) {
      this.last = elements;
    }
    endTime() {
      return 0.2;
    }
    stop = () => 0;
    pendingTokens = () => 0;
  },
}));

// jsdom stamps events with Date.now(); browsers use the performance clock, which the
// controller compares against. Match the browser.
Object.defineProperty(Event.prototype, "timeStamp", {
  configurable: true,
  get: () => performance.now(),
});

const { openTestProfile } = await import("../../app/harness");
const { IcrScreen } = await import("../../../src/features/icr/IcrScreen");
const icr = await import("../../../src/features/icr/controller");
const { useSettings } = await import("../../../src/state/settings");

beforeEach(async () => {
  await openTestProfile();
  icr.resetIcr();
  useSettings.getState().set("icr.count", 10);
});

afterEach(() => {
  icr.resetIcr();
});

describe("ICR screen", () => {
  it("answers with single keys and shows the per-character summary", async () => {
    const user = userEvent.setup();
    render(<IcrScreen />);
    expect(
      await screen.findByText(/No ICR answers yet, so Target uses the timeout./),
    ).toBeInTheDocument();
    expect(screen.getByText("K M")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText("Press the key")).toBeInTheDocument();

    const ch = icr.currentChar() ?? "";
    await user.keyboard(ch.toLowerCase());
    expect(await screen.findByText(ch, { selector: "span" })).toBeInTheDocument();

    // After the feedback, the next character is asked; then Esc stops the round.
    expect(await screen.findByText("Press the key", {}, { timeout: 3000 })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(await screen.findByRole("heading", { name: "Results" })).toBeInTheDocument();
    expect(screen.getByText("Stopped early. The answers so far are saved.")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Slowest" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: ch })).toBeInTheDocument();
  });

  it("pauses while a dialog or menu is open, instead of timing out", async () => {
    const user = userEvent.setup();
    render(<IcrScreen />);
    await user.click(screen.getByRole("button", { name: "Start" }));
    expect(await screen.findByText("Press the key")).toBeInTheDocument();
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    expect(await screen.findByText("Paused while a menu or dialog was open")).toBeInTheDocument();
    dialog.remove();
    await user.click(screen.getByRole("button", { name: "Resume" }));
    expect(await screen.findByText("Press the key")).toBeInTheDocument();
  });

  it("says when a custom set has too few characters", async () => {
    const user = userEvent.setup();
    useSettings.getState().set("icr.charset", "custom");
    render(<IcrScreen />);
    await user.type(screen.getByLabelText("Your characters"), "k<ar>");
    expect(screen.getByText(/left out: <AR>/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeDisabled();
  });
});
