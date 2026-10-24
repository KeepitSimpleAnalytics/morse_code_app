import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parseThemePreference } from "../../src/app/bindings";
import { resolveTheme, THEME_PREFERENCES, THEMES, useThemeStore } from "../../src/state/theme";

describe("resolveTheme", () => {
  it("follows the OS when the preference is system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("ignores the OS when the user picks a theme", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("night", false)).toBe("night");
  });
});

describe("themes", () => {
  it("every theme has its colours in tokens.css (light is the :root default)", () => {
    const css = readFileSync("src/styles/tokens.css", "utf8");
    for (const t of THEMES.filter((x) => x !== "light")) {
      expect(css, t).toContain(`:root[data-theme="${t}"]`);
    }
  });

  it("reads back every saved preference, and rejects unknown ones", () => {
    for (const p of THEME_PREFERENCES) expect(parseThemePreference(p)).toBe(p);
    expect(parseThemePreference("sepia")).toBeNull();
  });
});

describe("theme store", () => {
  beforeEach(() => {
    useThemeStore.setState({ preference: "system", systemPrefersDark: false });
  });

  it("updates the preference", () => {
    useThemeStore.getState().setPreference("dark");
    expect(useThemeStore.getState().preference).toBe("dark");
  });
});
