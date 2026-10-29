import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(__dirname, "..");

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.js", "**/*.test.jsx"],
    // Don't scan into git worktrees nested under .claude/ — they carry their
    // own copies of the test files but lack an installed node_modules (open-sse,
    // etc.), which makes provider imports fail during collection.
    exclude: ["**/node_modules/**", "**/.claude/**", "**/dist/**"],
    // Allow many it.concurrent cases (real provider smoke runs ~50 providers in parallel)
    maxConcurrency: 60,
    // Suppress noisy console output from handlers under test
    silent: false,
  },
  resolve: {
    // Use array form so subpath aliases (e.g. "@/lib/db/index.js") resolve correctly.
    alias: [
      { find: /^@testing-library\/react$/, replacement: resolve(root, "node_modules/@testing-library/react/dist/index.js") },
      { find: /^react-dom\/test-utils$/, replacement: resolve(root, "node_modules/react-dom/test-utils.js") },
      { find: /^react-dom\/client$/, replacement: resolve(root, "node_modules/react-dom/client.js") },
      { find: /^react-dom$/, replacement: resolve(root, "node_modules/react-dom/index.js") },
      { find: /^react\/jsx-runtime$/, replacement: resolve(root, "node_modules/react/jsx-runtime.js") },
      { find: /^react\/jsx-dev-runtime$/, replacement: resolve(root, "node_modules/react/jsx-dev-runtime.js") },
      { find: /^react$/, replacement: resolve(root, "node_modules/react/index.js") },
      { find: "better-sqlite3", replacement: resolve(__dirname, "node_modules/better-sqlite3") },
      { find: /^open-sse\//, replacement: resolve(__dirname, "../open-sse") + "/" },
      { find: "open-sse", replacement: resolve(__dirname, "../open-sse") },
      { find: /^@\//, replacement: resolve(__dirname, "../src") + "/" },
    ],
  },
});
