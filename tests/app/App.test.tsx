// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/App";
import { SCREENS } from "../../src/app/screens";
import { useNavStore } from "../../src/state/nav";
import { bindThemeToDocument, useThemeStore } from "../../src/state/theme";
import { openTestProfile } from "./harness";

beforeEach(async () => {
  await openTestProfile();
  useNavStore.setState({ screen: "koch" });
  useThemeStore.setState({ preference: "system", systemPrefersDark: false });
});

describe("App shell", () => {
  it("renders the sidebar groups and opens on Koch", () => {
    render(<App />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    for (const group of ["Learn", "Practice", "Tools", "Progress"]) {
      expect(within(nav).getByRole("heading", { name: group })).toBeInTheDocument();
    }
    expect(screen.getByRole("heading", { level: 1, name: "Koch Lessons" })).toBeInTheDocument();
    expect(within(nav).getByRole("button", { name: "Koch" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("navigates when a sidebar item is clicked", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Text Player" }));
    expect(screen.getByRole("heading", { level: 1, name: "Text Player" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Text Player" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("navigates with Ctrl+number", () => {
    render(<App />);
    fireEvent.keyDown(window, { code: "Digit3", key: "3", ctrlKey: true });
    expect(screen.getByRole("heading", { level: 1, name: "Random Groups" })).toBeInTheDocument();
  });

  it("opens every screen in the sidebar on its own page", async () => {
    render(<App />);
    for (const s of SCREENS) {
      await userEvent.click(screen.getByRole("button", { name: s.label }));
      expect(screen.getByRole("heading", { level: 1, name: s.title })).toBeInTheDocument();
    }
  });

  it("applies the chosen theme to <html data-theme>", async () => {
    const dispose = bindThemeToDocument(document, window);
    render(<App />);
    expect(document.documentElement.dataset.theme).toBe("light"); // "system", OS light
    const picker = screen.getByRole("combobox", { name: "Theme" });
    for (const theme of ["dark", "contrast", "night", "terminal", "light"]) {
      await userEvent.selectOptions(picker, theme);
      expect(document.documentElement.dataset.theme).toBe(theme);
    }
    expect(picker).toHaveValue("light");
    dispose();
  });
});
