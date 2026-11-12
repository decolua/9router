import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A component that renders <Link> without importing it compiles fine and only
// throws "Link is not defined" when that branch renders, e.g. the combos page
// showing a Smart Router whose provider is not configured.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function listJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJs(full));
    else if (/\.(jsx?|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const DECLARES_LINK = /import\s+Link\b|import\s*\{[^}]*\bLink\b[^}]*\}|(?:const|let|var|function)\s+Link\b/;

describe("JSX <Link> usage", () => {
  it("every file that renders <Link> imports or declares Link", () => {
    const offenders = listJs(path.join(ROOT, "src"))
      .filter((file) => {
        const src = fs.readFileSync(file, "utf8");
        return /<Link[\s>]/.test(src) && !DECLARES_LINK.test(src);
      })
      .map((file) => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});
