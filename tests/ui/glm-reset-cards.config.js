import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  // Dashboard .js components contain JSX; keep this transform out of unit tests.
  oxc: {
    include: [/\/src\/.*\.js$/, /ui\/glm-reset-cards\.smoke\.jsx$/],
    exclude: [],
    lang: "jsx",
    jsx: { runtime: "automatic", importSource: "react" },
  },
  test: {
    environment: "node",
    include: ["ui/glm-reset-cards.smoke.jsx"],
  },
  resolve: {
    alias: [
      { find: /^open-sse\//, replacement: resolve(dirname, "../../open-sse") + "/" },
      { find: "open-sse", replacement: resolve(dirname, "../../open-sse") },
      { find: /^@\//, replacement: resolve(dirname, "../../src") + "/" },
    ],
  },
});
