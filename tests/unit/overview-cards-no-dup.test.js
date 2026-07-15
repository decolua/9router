import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Resolve relative to this test file (repo root = ../../) so the guard passes
// regardless of the cwd vitest is invoked from.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");

// Guards against the copy-paste regression where OverviewCards rendered two
// identical "Cached Tokens" cards (breaking the intended 5-column grid).
describe("OverviewCards", () => {
  const source = fs.readFileSync(
    path.join(REPO_ROOT, "src/app/(dashboard)/dashboard/usage/components/OverviewCards.js"),
    "utf-8"
  );

  it("renders exactly one card per distinct metric label", () => {
    const labels = [
      "Total Requests",
      "Total Input Tokens",
      "Cached Tokens",
      "Output Tokens",
      "Est. Cost",
    ];
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const count = (source.match(new RegExp(escaped, "g")) || []).length;
      expect(count, `label "${label}" should appear exactly once`).toBe(1);
    }
  });
});
