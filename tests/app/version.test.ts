import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_VERSION } from "../../src/app/version";

const json = (path: string) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as { version: string };

describe("app version", () => {
  it("matches package.json and tauri.conf.json", () => {
    expect(json("../../package.json").version).toBe(APP_VERSION);
    expect(json("../../src-tauri/tauri.conf.json").version).toBe(APP_VERSION);
  });
});
