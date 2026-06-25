import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "vitest/config";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${resolve(root, "src")}/` },
      { find: /^open-sse\//, replacement: `${resolve(root, "open-sse")}/` },
      { find: "open-sse", replacement: resolve(root, "open-sse") },
    ],
  },
  test: {
    environment: "node",
    fileParallelism: false,
    setupFiles: ["tests/setup/vitest.setup.js"],
    sequence: {
      hooks: "list",
    },
  },
});
