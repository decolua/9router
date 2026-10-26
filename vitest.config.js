import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

// Mirrors jsconfig.json paths so tests resolve the same aliases as Next.js.
// Plain object export: no runtime import of vitest needed.
export default {
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: path.join(root, "src", "$1") },
      { find: /^open-sse\/(.*)$/, replacement: path.join(root, "open-sse", "$1") },
      { find: /^open-sse$/, replacement: path.join(root, "open-sse") },
    ],
  },
};
