// Vitest config for the reset-cards SSR smoke test. Separate from the root
// tests/vitest.config.js because it includes a .jsx spec (the root config's
// include pattern only matches *.test.js, and the root setup cannot transform
// JSX in .js component files).
import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  // Dashboard sources are .js files containing JSX. Vitest 4 transforms with
  // oxc, whose default filter excludes .js — scope an override to the reset
  // cards component and this spec so nothing else (e.g. CJS deps) is touched.
  oxc: {
    include: [/\/src\/.*\.js$/, /ui\/minimax-reset-cards\.smoke\.jsx$/],
    exclude: [],
    lang: "jsx",
    jsx: { runtime: "automatic", importSource: "react" },
  },
  test: {
    environment: "node",
    include: ["ui/minimax-reset-cards.smoke.jsx"],
  },
  resolve: {
    alias: [
      { find: /^open-sse\//, replacement: resolve(__dirname, "../../open-sse") + "/" },
      { find: "open-sse", replacement: resolve(__dirname, "../../open-sse") },
      { find: /^@\//, replacement: resolve(__dirname, "../../src") + "/" },
    ],
  },
});
