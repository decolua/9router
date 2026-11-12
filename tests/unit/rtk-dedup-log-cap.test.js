// Audit item: dedupLog stops at DEDUP_LINE_MAX (2000) and appends a marker.
// The cap is deliberate (filters/dedupLog.js header: "hard line cap";
// constants.js: "dedupLog truncation cap") and untested, so it stays — but the
// marker used to say only "truncated at 2000 lines", never how much was
// dropped. It must state the number of omitted lines.
import { describe, expect, it } from "vitest";
import { dedupLog } from "../../open-sse/rtk/filters/dedupLog.js";
import { DEDUP_LINE_MAX } from "../../open-sse/rtk/constants.js";

describe("dedupLog truncation cap", () => {
  it("states how many lines were omitted when the cap is hit", () => {
    const total = DEDUP_LINE_MAX + 1000;
    const input = Array.from({ length: total }, (_, i) => `const value${i} = compute(${i}); // line ${i}`).join("\n");
    const out = dedupLog(input);
    const lines = out.split("\n");

    expect(lines).toHaveLength(DEDUP_LINE_MAX + 1);
    expect(lines[DEDUP_LINE_MAX]).toMatch(/truncated/i);
    expect(lines[DEDUP_LINE_MAX]).toContain("1000");
    expect(lines[DEDUP_LINE_MAX]).toMatch(/omitted/i);
    // The cap is the documented behaviour: the tail of the input is dropped.
    expect(out).not.toContain(`const value${total - 1} `);
  });

  it("does not count the trailing newline as an omitted line", () => {
    const total = DEDUP_LINE_MAX + 1000;
    const input = Array.from({ length: total }, (_, i) => `unique line ${i}`).join("\n") + "\n";
    const out = dedupLog(input);
    expect(out.split("\n")[DEDUP_LINE_MAX]).toContain("1000");
  });

  it("does not add a marker when the input fits under the cap", () => {
    const input = Array.from({ length: DEDUP_LINE_MAX - 1 }, (_, i) => `unique line ${i}`).join("\n");
    const out = dedupLog(input);
    expect(out).toBe(input);
    expect(out).not.toMatch(/truncated/i);
  });
});
