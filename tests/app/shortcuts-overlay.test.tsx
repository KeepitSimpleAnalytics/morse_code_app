// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ShortcutsButton, ShortcutsOverlay } from "../../src/components/shell/Shortcuts";
import { useShortcutsKey, useShortcutsStore } from "../../src/components/shell/shortcuts-state";

function Harness() {
  useShortcutsKey();
  return (
    <>
      <input aria-label="Typing here" />
      <ShortcutsButton />
      <ShortcutsOverlay />
    </>
  );
}

afterEach(() => {
  useShortcutsStore.getState().setOpen(false);
});

describe("keyboard shortcut overlay (SPEC §10.3)", () => {
  it("opens with ? and closes with Esc", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard("?");
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
    expect(screen.getByText("Reveal")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("ignores ? while typing, and opens from the button", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.type(screen.getByLabelText("Typing here"), "?");
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    expect(screen.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeInTheDocument();
  });
});
