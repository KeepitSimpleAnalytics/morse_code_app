// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installProductionGuards } from "../../src/app/production-guards";

let dispose: () => void;

beforeEach(() => {
  dispose = installProductionGuards(window);
});
afterEach(() => {
  dispose();
  document.body.innerHTML = "";
});

function dispatch(target: EventTarget, event: Event): boolean {
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("production guards", () => {
  it("blocks F5 and Ctrl/Cmd+R", () => {
    const opts = { bubbles: true, cancelable: true };
    expect(dispatch(document.body, new KeyboardEvent("keydown", { key: "F5", ...opts }))).toBe(
      true,
    );
    expect(
      dispatch(document.body, new KeyboardEvent("keydown", { key: "r", ctrlKey: true, ...opts })),
    ).toBe(true);
    expect(
      dispatch(document.body, new KeyboardEvent("keydown", { key: "R", metaKey: true, ...opts })),
    ).toBe(true);
    expect(dispatch(document.body, new KeyboardEvent("keydown", { key: "r", ...opts }))).toBe(
      false,
    );
  });

  it("blocks the context menu except in text fields", () => {
    document.body.innerHTML = `<div id="d"></div><textarea id="t"></textarea><input id="i" type="text"><input id="c" type="checkbox">`;
    const ctx = () => new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    const el = (id: string) => {
      const found = document.getElementById(id);
      if (!found) throw new Error(`missing #${id}`);
      return found;
    };
    expect(dispatch(el("d"), ctx())).toBe(true);
    expect(dispatch(el("t"), ctx())).toBe(false);
    expect(dispatch(el("i"), ctx())).toBe(false);
    expect(dispatch(el("c"), ctx())).toBe(true);
  });
});
