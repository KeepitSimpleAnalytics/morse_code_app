// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../../src/App";
import { APP_VERSION } from "../../src/app/version";
import { boot } from "../../src/app/boot";
import { resetProgress, runImport, runV1Import, planV1 } from "../../src/app/data-actions";
import { activateProfile, createProfile, switchProfile } from "../../src/app/session";
import { usePlayerStore } from "../../src/features/player/store";
import { requireProfile, requireStore, useApp } from "../../src/state/app";
import { useNavStore } from "../../src/state/nav";
import { flushSettings, SAVE_DEBOUNCE_MS, useSettings } from "../../src/state/settings";
import { buildExportFile } from "../../src/storage/export";
import { freshApp, openTestProfile } from "./harness";

afterEach(() => {
  vi.useRealTimers();
});

describe("boot", () => {
  it("refuses to run on a plain browser page instead of falling back (SPEC §9.3)", async () => {
    useApp.setState({ phase: "booting", store: null, fatal: null });
    await boot();
    expect(useApp.getState().phase).toBe("fatal");
    render(<App />);
    expect(screen.getByRole("alert")).toHaveTextContent("Morse Trainer runs as a desktop app");
  });

  it("shows the red dev banner whenever the in-memory store is in use", async () => {
    await openTestProfile();
    render(<App />);
    expect(screen.getByText("Dev mode — progress is not saved")).toBeInTheDocument();
  });
});

describe("first run (SPEC §10.5)", () => {
  beforeEach(async () => {
    await freshApp();
  });

  it("creates a profile, shows the three cards, then starts on Koch", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("Enter a name for this profile.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Name"), "Sam");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByRole("heading", { name: "Three habits that work" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem").filter((li) => li.querySelector("h3"))).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Koch level 1: K and M" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start learning" }));

    expect(screen.getByRole("heading", { level: 1, name: "Koch Lessons" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Profile: Sam/ })).toBeInTheDocument();
    expect(screen.getByText("20/15 WPM · 600 Hz")).toBeInTheDocument();
    const [p] = await requireStore().listProfiles();
    expect(p?.name).toBe("Sam");
  });
});

describe("settings are saved per profile", () => {
  it("writes once, 300 ms after the last change (SPEC §9.4)", async () => {
    const store = await openTestProfile();
    const put = vi.spyOn(store, "putSettings");
    vi.useFakeTimers();
    const { set } = useSettings.getState();
    for (const wpm of [21, 22, 23, 24]) set("timing.speeds", { charWpm: wpm, effWpm: 15 });
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 1);
    expect(put).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]?.[1]).toEqual({ "timing.speeds": { charWpm: 24, effWpm: 15 } });
  });

  it("rejects invalid values before they reach storage", async () => {
    await openTestProfile();
    expect(() => {
      useSettings.getState().set("timing.speeds", { charWpm: 20, effWpm: 25 });
    }).toThrow();
  });

  it("keeps Player text, speed and the last screen separate for each profile", async () => {
    await openTestProfile("Ann");
    const ann = requireProfile().id;
    usePlayerStore.getState().set({ text: "ANN TEXT", speeds: { charWpm: 30, effWpm: 30 } });
    useNavStore.getState().go("player");

    await createProfile("Bob", "#7c5cd6");
    expect(usePlayerStore.getState().text).not.toBe("ANN TEXT");
    expect(useNavStore.getState().screen).toBe("koch");
    usePlayerStore.getState().set({ text: "BOB TEXT" });

    await switchProfile(ann);
    expect(usePlayerStore.getState().text).toBe("ANN TEXT");
    expect(usePlayerStore.getState().speeds).toEqual({ charWpm: 30, effWpm: 30 });
    expect(useNavStore.getState().screen).toBe("player");
  });

  it("warns about saved values that don't validate, instead of hiding them", async () => {
    const store = await openTestProfile();
    const id = requireProfile().id;
    await store.putSettings(id, { "audio.toneHz": 99999 }, 1);
    await activateProfile(requireProfile());
    expect(
      useApp
        .getState()
        .notices.map((n) => n.text)
        .join(),
    ).toMatch(/audio\.toneHz/);
    expect(useSettings.getState().values["audio.toneHz"]).toBe(600);
  });
});

describe("Settings screen", () => {
  it("About shows the version and opens the licences", async () => {
    const user = userEvent.setup();
    await openTestProfile();
    useNavStore.getState().go("settings");
    render(<App />);
    const about = screen.getByRole("region", { name: "About" });
    expect(within(about).getByText(`Version ${APP_VERSION}`, { exact: false })).toBeInTheDocument();
    await user.click(within(about).getByRole("button", { name: "Licences" }));
    const dialog = await screen.findByRole("dialog", { name: "Licences" });
    expect(within(dialog).getByText("Released under the MIT licence.")).toBeInTheDocument();
    expect(within(dialog).getByText(/^Callsign prefixes/)).toBeInTheDocument();
    expect(await within(dialog).findByText(/open-source packages/)).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("Filter"), "zustand");
    expect(within(dialog).getByText("zustand")).toBeInTheDocument();
    expect(within(dialog).queryByText("react-dom")).toBeNull();
  });

  it("edits training speed, which the top-bar chip reflects", async () => {
    await openTestProfile();
    useNavStore.getState().go("settings");

    render(<App />);
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    const timing = screen.getByRole("region", { name: "Timing" });
    const effective = within(timing).getByRole("slider", { name: /Effective speed/ });
    fireEvent.change(effective, { target: { value: "13" } });
    expect(useSettings.getState().values["timing.speeds"]).toEqual({ charWpm: 20, effWpm: 13 });
    expect(screen.getByText("20/13 WPM · 600 Hz")).toBeInTheDocument();
  });

  it("deleting a profile needs its name typed", async () => {
    await openTestProfile("Zed");
    await createProfile("Amy", "#7c5cd6");
    useNavStore.getState().go("settings");
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Delete…" }));
    const dialog = screen.getByRole("dialog", { name: "Delete Amy?" });
    const confirm = within(dialog).getByRole("button", { name: "Delete profile" });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Type "Amy" to confirm'), "Amy");
    await user.click(confirm);
    expect((await requireStore().listProfiles()).map((p) => p.name)).toEqual(["Zed"]);
    expect(useApp.getState().current?.name).toBe("Zed");
  });
});

describe("data actions", () => {
  it("Replace import restores a deleted profile with its settings (QA 7)", async () => {
    const store = await openTestProfile("Kim");
    useSettings.getState().set("timing.speeds", { charWpm: 25, effWpm: 11 });
    await flushSettings();
    const id = requireProfile().id;
    await store.setKochLevel(id, "lcwo", 6, "passed", 5);
    const file = buildExportFile(await store.exportProfiles([id]), "2.0.0", 9);

    await createProfile("Other", "#7c5cd6");
    await requireStore().deleteProfile(id);
    await runImport(file, "replace");

    expect(useApp.getState().profiles.map((p) => p.name)).toEqual(["Kim"]);
    expect(useApp.getState().current?.name).toBe("Kim");
    expect(useSettings.getState().values["timing.speeds"]).toEqual({ charWpm: 25, effWpm: 11 });
    expect(await store.getKochProgress(id)).toHaveLength(1);
  });

  it("v1 import updates the open profile's settings", async () => {
    await openTestProfile();
    await runV1Import(
      planV1(JSON.stringify({ kochLevel: 4, charSpeed: 18, effectiveSpeed: 12, frequency: 700 })),
    );
    const v = useSettings.getState().values;
    expect(v["timing.speeds"]).toEqual({ charWpm: 18, effWpm: 12 });
    expect(v["audio.toneHz"]).toBe(700);
    expect(v["learning.kochOrder"]).toBe("classic-v1");
  });

  it("reset clears progress but keeps settings", async () => {
    const store = await openTestProfile();
    const id = requireProfile().id;
    useSettings.getState().set("audio.toneHz", 750);
    await flushSettings();
    await store.setKochLevel(id, "lcwo", 6, "passed", 5);
    await resetProgress();
    expect(await store.getKochProgress(id)).toEqual([]);
    expect(useSettings.getState().values["audio.toneHz"]).toBe(750);
  });
});
