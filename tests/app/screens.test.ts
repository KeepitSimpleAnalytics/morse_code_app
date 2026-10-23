import { describe, expect, it } from "vitest";
import { SCREENS, SHORTCUT_SCREENS, screenById, shortcutIndex } from "../../src/app/screens";
import { screenForShortcut } from "../../src/app/shortcuts";
import { layoutPattern } from "../../src/components/morse-layout";

describe("screen registry", () => {
  it("has unique ids", () => {
    const ids = SCREENS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("matches the sidebar grouping in SPEC §10.1", () => {
    const grouped = (group: string) => SCREENS.filter((s) => s.group === group).map((s) => s.id);
    expect(grouped("Learn")).toEqual(["koch", "icr"]);
    expect(grouped("Practice")).toEqual(["groups", "words", "callsigns", "qso", "custom"]);
    expect(grouped("Tools")).toEqual(["player", "sending"]);
    expect(grouped("Progress")).toEqual(["stats"]);
    expect(grouped("System")).toEqual(["settings"]);
  });

  it("assigns Ctrl+1…9 to the first nine modes", () => {
    expect(SHORTCUT_SCREENS).toHaveLength(9);
    expect(shortcutIndex("koch")).toBe(1);
    expect(shortcutIndex("sending")).toBe(9);
    expect(shortcutIndex("stats")).toBeNull();
  });

  it("throws on an unknown screen rather than falling back", () => {
    // @ts-expect-error deliberately invalid id
    expect(() => screenById("nope")).toThrow(/Unknown screen/);
  });
});

describe("screenForShortcut", () => {
  const key = (code: string, mods: Partial<KeyboardEventInit> = {}) =>
    ({
      code,
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      ...mods,
    }) as KeyboardEvent;

  it("maps Ctrl+digit to a screen", () => {
    expect(screenForShortcut(key("Digit1", { ctrlKey: true }))).toBe("koch");
    expect(screenForShortcut(key("Digit8", { ctrlKey: true }))).toBe("player");
  });

  it("ignores digits without the modifier, with extra modifiers, and Digit0", () => {
    expect(screenForShortcut(key("Digit1"))).toBeNull();
    expect(screenForShortcut(key("Digit1", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(screenForShortcut(key("Digit0", { ctrlKey: true }))).toBeNull();
  });
});

describe("layoutPattern", () => {
  it("lays out CW with standard spacing (30 units including the 7-unit rest)", () => {
    const { letters, cycleUnits } = layoutPattern("-.-. .--");
    expect(letters.map((l) => l.map((e) => e.startUnits))).toEqual([
      [0, 4, 6, 10],
      [14, 16, 20],
    ]);
    expect(cycleUnits).toBe(30);
  });
});
