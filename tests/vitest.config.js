import { defineConfig } from "vitest/config";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["**/*.test.js"],
    // Suppress noisy console output from handlers under test
    silent: false,
  },
  resolve: {
    alias: {
      // Resolve open-sse/* imports to the actual local package
      "open-sse": resolve(__dirname, "../open-sse"),
    },
  },
});
