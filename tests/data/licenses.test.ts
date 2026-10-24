import { describe, expect, it } from "vitest";
import { inputsHash } from "../../scripts/licenses-hash.mjs";
import data from "../../src/data/third-party-licenses.json";

describe("third-party licences", () => {
  it("are up to date with the lockfiles and the generator (else run pnpm licenses:gen)", () => {
    expect(data.inputsHash).toBe(inputsHash());
  });

  it("list every shipped package with its licence text", () => {
    expect(data.packages.length).toBeGreaterThan(100);
    for (const p of data.packages) {
      expect(p.license, p.name).toBeTruthy();
      expect(data.texts[p.text], p.name).toBeTruthy();
    }
    for (const name of ["react", "zod", "tauri", "webview2-com", "@fontsource-variable/inter"]) {
      expect(data.packages.some((p) => p.name === name)).toBe(true);
    }
    expect(data.packages.some((p) => p.name === "morse-trainer")).toBe(false);
  });
});
