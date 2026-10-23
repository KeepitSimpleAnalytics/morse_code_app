// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { TextPlayer } from "../../../src/features/player/TextPlayer";
import { usePlayerStore } from "../../../src/features/player/store";
import { suggestTitle } from "../../../src/features/player/snippets-model";
import { requireProfile, requireStore } from "../../../src/state/app";
import { openTestProfile } from "../../app/harness";

beforeEach(async () => {
  await openTestProfile();
  usePlayerStore.setState({ text: "CQ POTA DE K1ABC", status: "idle", liveMode: false });
});

describe("Text Player snippets (SPEC §7.8)", () => {
  it("suggests a title from the first words", () => {
    expect(suggestTitle("  CQ CQ\nDE  W1AW W1AW K extra words")).toBe("CQ CQ DE W1AW W1AW K");
    expect(suggestTitle("   ")).toBe("Untitled");
  });

  it("saves, renames, loads and deletes snippets for the profile", async () => {
    const user = userEvent.setup();
    render(<TextPlayer />);
    await user.click(screen.getByRole("button", { name: "Snippets" }));
    let dialog = screen.getByRole("dialog", { name: "Snippets" });
    expect(within(dialog).getByLabelText("Save the current text as")).toHaveValue(
      "CQ POTA DE K1ABC",
    );
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    const list = await within(dialog).findByRole("list", { name: "Saved snippets" });

    await user.click(within(list).getByRole("button", { name: "Rename CQ POTA DE K1ABC" }));
    const input = within(list).getByLabelText("Snippet title");
    await user.clear(input);
    await user.type(input, "Park call{Enter}");
    expect(await within(list).findByText("Park call")).toBeInTheDocument();
    expect((await requireStore().listSnippets(requireProfile().id))[0]?.title).toBe("Park call");

    usePlayerStore.getState().set({ text: "something else" });
    await user.click(within(list).getByText("Park call"));
    expect(usePlayerStore.getState().text).toBe("CQ POTA DE K1ABC");

    await user.click(screen.getByRole("button", { name: "Snippets" }));
    dialog = screen.getByRole("dialog", { name: "Snippets" });
    await user.click(await within(dialog).findByRole("button", { name: "Delete Park call" }));
    await user.click(screen.getByRole("button", { name: "Delete snippet" }));
    expect(await screen.findByText("No snippets yet. Save one above.")).toBeInTheDocument();
  });
});
