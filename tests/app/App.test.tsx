// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../../src/App";
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

  it("states honestly that unbuilt screens are not built yet", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Stats" }));
    expect(screen.getByText(/Not built yet\. Arrives in phase 7\./)).toBeInTheDocument();
  });

  it("applies the chosen theme to <html data-theme>", async () => {
    const dispose = bindThemeToDocument(document, window);
    render(<App />);
    expect(document.documentElement.dataset.theme).toBe("light");
    await userEvent.click(screen.getByRole("radio", { name: "Dark" }));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
    dispose();
  });
});
