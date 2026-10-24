import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { APP_VERSION } from "../../src/app/version";

const json = (path: string) =>
  JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8")) as { version: string };

describe("app version", () => {
  it("matches package.json, tauri.conf.json and Cargo.toml", () => {
    expect(json("../../package.json").version).toBe(APP_VERSION);
    expect(json("../../src-tauri/tauri.conf.json").version).toBe(APP_VERSION);
    const cargo = readFileSync(new URL("../../src-tauri/Cargo.toml", import.meta.url), "utf8");
    expect(/^version = "([^"]+)"/m.exec(cargo)?.[1]).toBe(APP_VERSION);
  });
});
