/** Kept equal to package.json, tauri.conf.json and Cargo.toml by tests/app/version.test.ts. */
export const APP_VERSION = "2.0.0";

/** Where releases are published (SPEC §16 Q5). Opening these is allowed in capabilities/default.json. */
export const REPO_URL = "https://github.com/KeepitSimpleAnalytics/morse_code_app";
export const RELEASES_URL = `${REPO_URL}/releases`;
