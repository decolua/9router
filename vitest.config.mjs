import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    // ponytail: only the MCP gateway suites are stable across local + CI.
    // Most of the repo's other suites are broken/flaky (never had a runner).
    // Expand include as upstream stabilizes suites.
    include: ["tests/unit/mcp-*.test.js"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
