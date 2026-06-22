import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Use array form so subpath aliases (e.g. "@/lib/db/index.js") resolve correctly.
    alias: [
      { find: /^open-sse\//, replacement: resolve(root, "open-sse") + "/" },
      { find: "open-sse", replacement: resolve(root, "open-sse") },
      { find: /^@\//, replacement: resolve(root, "src") + "/" },
      { find: "@", replacement: resolve(root, "src") },
    ],
  },
  test: {
    environment: "node",
    include: ["**/*.test.js"],
    // Don't scan into git worktrees nested under .claude/ — they carry their
    // own copies of the test files but lack an installed node_modules (open-sse,
    // etc.), which makes provider imports fail during collection.
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.worktrees/**",
      "**/.claude/**",
      "**/.pi/**",
      "**/.omc/**",
      "**/.serena/**",
      "**/.atl/**",
      "**/dist/**",
    ],
    // Allow many it.concurrent cases (real provider smoke runs ~50 providers in parallel)
    maxConcurrency: 60,
    silent: false,
  },
});
