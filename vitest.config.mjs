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
    exclude: [
      "**/node_modules/**",
      "**/.next/**",
      "**/.worktrees/**",
      "**/dist/**",
    ],
    silent: false,
  },
});
