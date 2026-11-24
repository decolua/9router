// The quota colour policy (`> 70` green, `>= 30` yellow, else red) was written
// out four times: QuotaProgressBar, QuotaTable, getStatusColor and
// getStatusEmoji. All four agreed, but nothing made them agree -- an edit to one
// would have shown a model as green in the table and yellow in the progress bar
// above it, with no test and no type to catch it.
//
// These tests pin the boundaries once, and then pin that the consumers still
// read them from here rather than restating them. The second half is the part
// that matters: the arithmetic tests below pass just as happily against four
// copies as against one.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import {
  quotaStatusLevel,
  getStatusColor,
  getStatusEmoji,
  QUOTA_STATUS_HEALTHY_ABOVE,
  QUOTA_STATUS_WARNING_AT_OR_ABOVE,
} from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

const DIR = new URL(
  "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/",
  import.meta.url,
);
const source = (name) => readFileSync(new URL(name, DIR), "utf8");

describe("quota status thresholds", () => {
  it("keeps the boundaries the four copies used to agree on", () => {
    expect(QUOTA_STATUS_HEALTHY_ABOVE).toBe(70);
    expect(QUOTA_STATUS_WARNING_AT_OR_ABOVE).toBe(30);

    // Green is strictly above 70; 70 itself is yellow. Yellow reaches down to
    // and includes 30. Everything below, 0 included, is red.
    expect(quotaStatusLevel(100)).toBe("green");
    expect(quotaStatusLevel(70.1)).toBe("green");
    expect(quotaStatusLevel(70)).toBe("yellow");
    expect(quotaStatusLevel(30)).toBe("yellow");
    expect(quotaStatusLevel(29.9)).toBe("red");
    expect(quotaStatusLevel(0)).toBe("red");
  });

  it("reports the same level through every accessor", () => {
    const EMOJI = { green: "\u{1F7E2}", yellow: "\u{1F7E1}", red: "\u{1F534}" };
    for (let p = 0; p <= 100; p += 0.5) {
      const level = quotaStatusLevel(p);
      expect(getStatusColor(p), `colour at ${p}%`).toBe(level);
      expect(getStatusEmoji(p), `emoji at ${p}%`).toBe(EMOJI[level]);
    }
  });

  // The wiring. Without these, reverting either component to its own inline
  // `> 70` / `>= 30` leaves every assertion above green.
  it("the progress bar reads the shared policy instead of restating it", () => {
    const src = source("QuotaProgressBar.js");
    expect(src).toMatch(/import\s*\{[^}]*quotaStatusLevel[^}]*\}\s*from\s*"\.\/utils"/);
    expect(src).toMatch(/COLOR_CLASSES\[quotaStatusLevel\(/);
    expect(src).not.toMatch(/remainingPercentage\s*>=?\s*(70|30)\b/);
  });

  it("the table reads the shared policy instead of restating it", () => {
    const src = source("QuotaTable.js");
    expect(src).toMatch(/import\s*\{[^}]*quotaStatusLevel[^}]*\}\s*from\s*"\.\/utils"/);
    expect(src).toMatch(/COLOR_CLASSES\[quotaStatusLevel\(/);
    expect(src).not.toMatch(/remainingPercentage\s*>=?\s*(70|30)\b/);
  });

  it("both consumers cover every level, so no percentage renders undefined", () => {
    // COLOR_CLASSES is keyed by level; a missing key would return undefined and
    // the component would read `.text` off it at render time.
    for (const name of ["QuotaProgressBar.js", "QuotaTable.js"]) {
      const src = source(name);
      for (const level of ["green", "yellow", "red"]) {
        expect(src, `${name} is missing the ${level} entry`).toMatch(
          new RegExp("\\b" + level + ":\\s*\\{"),
        );
      }
    }
  });
});
