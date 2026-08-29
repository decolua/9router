import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/unit/ui/**/*.test.jsx"],
    exclude: ["**/node_modules/**", "**/.claude/**", "**/dist/**"],
  },
  resolve: {
    alias: [
      { find: /^@testing-library\/react$/, replacement: resolve(root, "node_modules/@testing-library/react/dist/index.js") },
      { find: /^react-dom\/test-utils$/, replacement: resolve(root, "node_modules/react-dom/test-utils.js") },
      { find: /^react-dom\/client$/, replacement: resolve(root, "node_modules/react-dom/client.js") },
      { find: /^react-dom$/, replacement: resolve(root, "node_modules/react-dom/index.js") },
      { find: /^react\/jsx-runtime$/, replacement: resolve(root, "node_modules/react/jsx-runtime.js") },
      { find: /^react\/jsx-dev-runtime$/, replacement: resolve(root, "node_modules/react/jsx-dev-runtime.js") },
      { find: /^react$/, replacement: resolve(root, "node_modules/react/index.js") },
      { find: /^open-sse\//, replacement: resolve(root, "open-sse") + "/" },
      { find: "open-sse", replacement: resolve(root, "open-sse") },
      { find: /^@\//, replacement: resolve(root, "src") + "/" },
    ],
  },
});
