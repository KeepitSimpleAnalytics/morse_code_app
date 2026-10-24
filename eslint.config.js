import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import prettier from "eslint-config-prettier";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: ["dist/", "coverage/", "legacy/", "src-tauri/target/", "src-tauri/gen/"],
  },
  js.configs.recommended,
  {
    // Root config files (vite, vitest) belong to tsconfig.node.json; lint them without type info.
    files: ["*.ts"],
    extends: [tseslint.configs.strict, tseslint.configs.stylistic],
  },
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
      // The stylistic preset asks for `x!` while the strict preset forbids it; keep strict.
      "@typescript-eslint/non-nullable-type-assertion-style": "off",
      // Spreading a string iterates code points, which is exactly what the tokenizer
      // and Morse patterns need.
      "@typescript-eslint/no-misused-spread": "off",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["*.{js,ts}", "scripts/**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
  {
    // CLAUDE.md: src/core is pure TypeScript. No DOM, Web Audio, Tauri, React or app-layer imports.
    files: ["src/core/**/*.ts"],
    languageOptions: { globals: {} },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@tauri-apps/*",
                "react",
                "react/*",
                "react-dom",
                "react-dom/*",
                "zustand",
                "zustand/*",
                "**/audio/**",
                "**/storage/**",
                "**/state/**",
                "**/features/**",
                "**/components/**",
              ],
              message:
                "src/core must stay pure TypeScript (CLAUDE.md). Inject platform dependencies instead.",
            },
          ],
        },
      ],
      "no-restricted-globals": [
        "error",
        "window",
        "document",
        "navigator",
        "localStorage",
        "sessionStorage",
        "requestAnimationFrame",
        "AudioContext",
        "OfflineAudioContext",
      ],
    },
  },
  prettier,
);
