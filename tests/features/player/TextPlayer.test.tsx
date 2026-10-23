// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { TextPlayer } from "../../../src/features/player/TextPlayer";
import { usePlayerStore } from "../../../src/features/player/store";

beforeEach(() => {
  usePlayerStore.setState({
    text: "HI",
    startOffset: null,
    active: null,
    status: "idle",
    liveMode: false,
    hideText: false,
    error: null,
    notice: null,
  });
});

describe("Text Player", () => {
  it("shows the code for the text and updates as you type", () => {
    const { container } = render(<TextPlayer />);
    expect(container.textContent).toContain("....");
    fireEvent.change(screen.getByLabelText("Text to play as Morse"), { target: { value: "K" } });
    expect(container.textContent).toContain("-.-");
  });

  it("counts characters that aren't in Morse", () => {
    usePlayerStore.setState({ text: "A#B é" });
    render(<TextPlayer />);
    expect(screen.getByText("2 not in Morse, skipped")).toBeInTheDocument();
  });

  it("switches the code format", async () => {
    const { container } = render(<TextPlayer />);
    await userEvent.click(screen.getByRole("radio", { name: "di-dah" }));
    expect(container.textContent).toContain("di-di-di-dit");
  });

  it("inserts a prosign from the palette", async () => {
    render(<TextPlayer />);
    await userEvent.click(screen.getByRole("button", { name: "AR" }));
    expect(usePlayerStore.getState().text).toContain("<AR>");
  });

  it("sets the play-from point by clicking the code", async () => {
    usePlayerStore.setState({ text: "AB CD" });
    const { container } = render(<TextPlayer />);
    const third = container.querySelector('[data-i="3"]');
    if (!third) throw new Error("code span missing");
    await userEvent.click(third);
    expect(usePlayerStore.getState().startOffset).toBe(3);
    expect(screen.getByRole("button", { name: "Play from the start" })).toBeInTheDocument();
  });

  it("decodes pasted Morse and can send it back as text", async () => {
    render(<TextPlayer />);
    await userEvent.click(screen.getByRole("radio", { name: "Morse → Text" }));
    expect(screen.getByText("HELLO WORLD")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Use as text/ }));
    expect(usePlayerStore.getState().text).toBe("HELLO WORLD");
  });
});
