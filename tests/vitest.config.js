import { defineConfig } from "vitest/config";
import { transformWithOxc } from "vite";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// Dashboard components are JSX in .js files (Next compiles them that way);
// Vite only parses JSX in .jsx, so compile these before import analysis.
const jsxInJs = {
  name: "dashboard-jsx-in-js",
  enforce: "pre",
  transform(code, id) {
    if (!/\/src\/(app|shared)\/.*\.js$/.test(id)) return null;
    return transformWithOxc(code, id, { lang: "jsx", jsx: { runtime: "automatic" } });
  },
};

export default defineConfig({
  plugins: [jsxInJs],
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.js"],
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
      { find: /^open-sse\//, replacement: resolve(__dirname, "../open-sse") + "/" },
      { find: "open-sse", replacement: resolve(__dirname, "../open-sse") },
      { find: /^@\//, replacement: resolve(__dirname, "../src") + "/" },
    ],
  },
});
