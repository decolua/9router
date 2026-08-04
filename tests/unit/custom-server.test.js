import { describe, it, expect } from "vitest";
import { createRequire } from "module";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

describe("Next.js Server Process Title", () => {
  it("sets the process title to '9router next-server'", () => {
    // Save original title
    const originalTitle = process.title;

    // Resolve server.js relative to custom-server.js (which is at the root)
    const serverPath = path.resolve(__dirname, "../../server.js");

    // Write a dummy server.js so Node.js resolver finds it on disk
    fs.writeFileSync(serverPath, "module.exports = {};");

    // Populate require.cache to mock require("./server.js")
    require.cache[serverPath] = {
      id: serverPath,
      filename: serverPath,
      loaded: true,
      exports: {},
    };

    try {
      // Require custom-server.js
      require("../../custom-server.js");

      // Verify process.title is updated
      expect(process.title).toBe("9router next-server");

      // Try to set it to something else
      process.title = "next-server";
      expect(process.title).toBe("9router next-server");
    } finally {
      // Restore original title
      const originalSetTitle = Object.getOwnPropertyDescriptor(process, "title")?.set;
      if (originalSetTitle) {
        Object.defineProperty(process, "title", {
          value: originalTitle,
          writable: true,
          configurable: true
        });
      } else {
        process.title = originalTitle;
      }

      // Clean up require.cache
      delete require.cache[serverPath];
      delete require.cache[path.resolve(__dirname, "../../custom-server.js")];

      // Remove dummy server.js
      try {
        fs.unlinkSync(serverPath);
      } catch {}
    }
  });
});
