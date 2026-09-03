import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default {
  test: {
    environment: "node",
    globals: true,
    include: ["src/lib/webshare/webshareSync.test.js"],
    silent: false,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "../src"),
    },
  },
};
