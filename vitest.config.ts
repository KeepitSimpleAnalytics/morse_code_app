import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    // Core and store tests run in plain Node. UI tests opt in with
    // `// @vitest-environment jsdom` at the top of the file.
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    css: { modules: { classNameStrategy: "non-scoped" } },
  },
});
