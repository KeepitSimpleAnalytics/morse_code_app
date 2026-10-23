import { beforeEach, describe, expect, it } from "vitest";
import { resolveTheme, useThemeStore } from "../../src/state/theme";

describe("resolveTheme", () => {
  it("follows the OS when the preference is system", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("ignores the OS when the user picks a theme", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("theme store", () => {
  beforeEach(() => {
    useThemeStore.setState({ preference: "system", systemPrefersDark: false });
  });

  it("defaults to system", () => {
    expect(useThemeStore.getState().preference).toBe("system");
  });

  it("updates the preference", () => {
    useThemeStore.getState().setPreference("dark");
    expect(useThemeStore.getState().preference).toBe("dark");
  });
});
