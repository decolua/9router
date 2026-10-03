// A connection carries one flat field per model lock (`modelLock_<model>`, plus
// `modelLock___all` for the account-level one). The provider cards picked the
// timestamp for their countdown with
//
//   .filter(([k]) => k.startsWith("modelLock_")).map(([, v]) => v).filter(Boolean).sort()[0]
//
// — earliest lock, expired or not. `isCooldown` was computed separately, by a
// scan that *did* compare against now. So on a connection with one lapsed lock
// and one still live, the badge said cooldown (correct) while the value handed
// to CooldownTimer was in the past, and CooldownTimer renders nothing once its
// target has gone by: the countdown silently disappeared exactly when there was
// more than one lock to count.
//
// `getEarliestModelLockUntil` already existed for this — its docblock says "Used
// for UI cooldown display" — and skips expired entries. These pin its behaviour
// and that both cards now ask it.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import { getEarliestModelLockUntil } from "../../open-sse/services/accountFallback.js";

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();

describe("getEarliestModelLockUntil", () => {
  it("skips a lapsed lock and returns the earliest live one", () => {
    // The reported shape: the lapsed lock sorts first, so the old expression
    // returned it and the countdown had nothing to count down to.
    const connection = {
      id: "conn-1",
      modelLock_old: iso(-3600_000),
      modelLock_soon: iso(120_000),
      modelLock_later: iso(600_000),
    };
    expect(getEarliestModelLockUntil(connection)).toBe(connection.modelLock_soon);
  });

  it("returns null when every lock has lapsed", () => {
    const connection = { modelLock_a: iso(-1000), modelLock_b: iso(-60_000) };
    expect(getEarliestModelLockUntil(connection)).toBe(null);
  });

  it("counts the account-level lock like any other", () => {
    const connection = { modelLock___all: iso(30_000), modelLock_x: iso(90_000) };
    expect(getEarliestModelLockUntil(connection)).toBe(connection.modelLock___all);
  });

  it("ignores fields that are not locks", () => {
    const connection = { id: "c", lastErrorAt: iso(5_000), modelLock_x: iso(50_000) };
    expect(getEarliestModelLockUntil(connection)).toBe(connection.modelLock_x);
  });

  it("handles a connection with no locks at all", () => {
    expect(getEarliestModelLockUntil({ id: "c" })).toBe(null);
    expect(getEarliestModelLockUntil(null)).toBe(null);
  });
});

// The cards are client components and this repo has no React renderer in its
// test setup, so the wiring is pinned at the source level. Without this, both
// cards could go back to their own inline scan and every test above would stay
// green — which is the shape of the bug in the first place.
describe("the provider cards read the shared helper", () => {
  const CARDS = [
    "src/app/(dashboard)/dashboard/providers/components/ConnectionsCard.js",
    "src/app/(dashboard)/dashboard/providers/[id]/ConnectionRow.js",
  ];

  for (const file of CARDS) {
    const source = readFileSync(new URL("../../" + file, import.meta.url), "utf8");

    it(`${file} imports getEarliestModelLockUntil`, () => {
      expect(source).toMatch(
        /import\s*\{\s*getEarliestModelLockUntil\s*\}\s*from\s*["']open-sse\/services\/accountFallback\.js["']/,
      );
    });

    it(`${file} no longer scans modelLock_ by hand`, () => {
      expect(source).not.toMatch(/startsWith\(\s*["']modelLock_["']\s*\)/);
    });
  }
});
