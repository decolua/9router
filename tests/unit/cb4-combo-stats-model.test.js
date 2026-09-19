/**
 * CB4 — combo-stats UI display model (tests).
 *
 * Node-env precedent (see f24d-badge-worst-state.test.js): the repo's vitest
 * runs in `environment: "node"` with no jsdom and no JSX transform, so
 * "rendering" is proven at the layer that actually decides what the chip/row
 * shows — the pure comboStats model every React component reads from. If a
 * value is not produced here, it cannot reach the screen.
 *
 * The contract under test (D13 / RC1 / F12):
 *  • 62.5% renders as "62.5%", not "63%" (no rounding away a real half).
 *  • Missing data renders "—", never a fabricated 0%/100%.
 *  • Members sort worst-first by failureRate (the failing one on top).
 *  • "parcial" surfaces exactly when coverage is partial.
 *  • A fetch failure resolves (never throws) and degrades the chip to "—".
 */
import { describe, it, expect } from "vitest";
import {
  formatPct,
  chipLabel,
  chipTone,
  mapPeriodToRange,
  coverageBadgeLabel,
  pickComboEntry,
  sortMembersByFailure,
  relativeErrorText,
  breakerDotColor,
  memberRowView,
  buildComboSuccessMap,
  loadComboStats,
} from "../../src/app/(dashboard)/dashboard/combos/components/comboStats.js";

/** Seed shaped EXACTLY like GET /api/usage/combo-stats output (CB3 aggregate). */
function seedPayload() {
  return {
    window: { range: "24h", from: "2026-01-01T00:00:00.000Z", to: "2026-01-02T00:00:00.000Z" },
    coverage: "full",
    sources: { failuresRecorded: true, legacyWinnersWithoutCombo: 0, attributedRows: 16 },
    combos: [
      {
        combo: "my-combo",
        window: "24h",
        attempts: 8,
        successes: 5,
        failures: 3,
        successRate: 0.625,
        members: [
          {
            member: "B",
            provider: "openai",
            model: "gpt-mini",
            attempts: 8,
            successes: 7,
            failures: 1,
            failureRate: 0.125,
            lastErrorStatus: "error:429",
            lastErrorAt: null,
            breaker: { state: "CLOSED", failureCount: 0, retryAfterMs: 0 },
            connections: [],
          },
          {
            member: "A",
            provider: "groq",
            model: "llama-x",
            attempts: 8,
            successes: 3,
            failures: 5,
            failureRate: 0.625,
            lastErrorStatus: "error:503",
            lastErrorAt: null,
            breaker: { state: "OPEN", failureCount: 5, retryAfterMs: 30000 },
            connections: [],
          },
          {
            member: "C",
            provider: "x",
            model: "m",
            attempts: 0,
            successes: 0,
            failures: 0,
            failureRate: null,
            lastErrorStatus: null,
            lastErrorAt: null,
            breaker: null,
            connections: [],
          },
        ],
      },
      {
        combo: "fresh-combo",
        window: "24h",
        attempts: 0,
        successes: 0,
        failures: 0,
        successRate: null,
        members: [],
      },
    ],
  };
}

describe("formatPct — honest rounding, never a fabricated number", () => {
  it("renders a real half as 62.5% (not rounded to 63%)", () => {
    expect(formatPct(0.625)).toBe("62.5%");
  });
  it("renders whole and clean rates without a trailing .0", () => {
    expect(formatPct(1)).toBe("100%");
    expect(formatPct(0.5)).toBe("50%");
    expect(formatPct(0)).toBe("0%");
  });
  it("keeps one decimal for thirds", () => {
    expect(formatPct(0.3333)).toBe("33.3%");
  });
  it("turns absence into a dash, never 0%", () => {
    expect(formatPct(null)).toBe("—");
    expect(formatPct(undefined)).toBe("—");
    expect(formatPct(NaN)).toBe("—");
  });
});

describe("chipLabel — the card chip value", () => {
  it("shows the combo successRate", () => {
    expect(chipLabel({ successRate: 0.625 })).toBe("62.5%");
  });
  it("shows — for a null rate (attempts 0)", () => {
    expect(chipLabel({ successRate: null, attempts: 0 })).toBe("—");
  });
  it("shows — when the combo has no entry at all (no data / fetch gap)", () => {
    expect(chipLabel(null)).toBe("—");
    expect(chipLabel(undefined)).toBe("—");
  });
});

describe("chipTone — real rates colored, absence neutral (no false red)", () => {
  it("is neutral grey for a missing rate", () => {
    expect(chipTone(null)).toContain("text-text-muted");
  });
  it("is emerald at high success and red at low", () => {
    expect(chipTone(0.95)).toContain("emerald");
    expect(chipTone(0.4)).toContain("red");
    expect(chipTone(0.75)).toContain("amber");
  });
});

describe("mapPeriodToRange — clamp UsageStats periods to real windows", () => {
  it("maps today→24h and 60d→30d (the widest supported)", () => {
    expect(mapPeriodToRange("today")).toBe("24h");
    expect(mapPeriodToRange("60d")).toBe("30d");
    expect(mapPeriodToRange("7d")).toBe("7d");
  });
  it("falls back to 24h for anything unknown", () => {
    expect(mapPeriodToRange("nope")).toBe("24h");
  });
});

describe("coverageBadgeLabel — communicate partial history honestly", () => {
  it("says parcial when coverage is partial", () => {
    expect(coverageBadgeLabel({ coverage: "partial" })).toBe("parcial");
  });
  it("stays silent when full or unknown", () => {
    expect(coverageBadgeLabel({ coverage: "full" })).toBeNull();
    expect(coverageBadgeLabel(null)).toBeNull();
  });
});

describe("pickComboEntry — join card to payload by declared name", () => {
  it("finds the matching combo entry", () => {
    const e = pickComboEntry(seedPayload(), "my-combo");
    expect(e).toBeTruthy();
    expect(e.successRate).toBe(0.625);
  });
  it("returns null for an unmatched combo or empty payload (chip → —)", () => {
    expect(pickComboEntry(seedPayload(), "ghost")).toBeNull();
    expect(pickComboEntry(null, "my-combo")).toBeNull();
  });
});

describe("sortMembersByFailure — problematic member on top", () => {
  it("orders member A (5/8) before member B (1/8)", () => {
    const combo = pickComboEntry(seedPayload(), "my-combo");
    const ordered = sortMembersByFailure(combo.members);
    expect(ordered[0].member).toBe("A");
    expect(ordered[0].failures).toBe(5);
    expect(ordered[0].attempts).toBe(8);
    expect(ordered.map((m) => m.member)).toEqual(["A", "B", "C"]);
  });
  it("sends an unknown-rate member (attempts 0) to the bottom, not the top", () => {
    const ordered = sortMembersByFailure([
      { member: "unknown", failureRate: null },
      { member: "bad", failureRate: 0.9 },
    ]);
    expect(ordered.map((m) => m.member)).toEqual(["bad", "unknown"]);
  });
});

describe("relativeErrorText — pt-BR age, null-safe", () => {
  const NOW = Date.parse("2026-01-02T00:00:00.000Z");
  it("renders hours ago", () => {
    expect(relativeErrorText(new Date(NOW - 3 * 3600_000).toISOString(), NOW)).toBe("há 3h");
  });
  it("renders minutes and days", () => {
    expect(relativeErrorText(new Date(NOW - 45 * 60_000).toISOString(), NOW)).toBe("há 45min");
    expect(relativeErrorText(new Date(NOW - 2 * 86400_000).toISOString(), NOW)).toBe("há 2d");
  });
  it("returns null when there is no timestamp (no bogus age)", () => {
    expect(relativeErrorText(null, NOW)).toBeNull();
    expect(relativeErrorText("not-a-date", NOW)).toBeNull();
  });
});

describe("breakerDotColor — live state color, unknown never red", () => {
  it("colors OPEN red and null grey", () => {
    expect(breakerDotColor({ state: "OPEN" })).toBe("#ef4444");
    expect(breakerDotColor({ state: "CLOSED" })).toBe("#22c55e");
    expect(breakerDotColor(null)).toBe("#6b7280");
  });
});

describe("memberRowView — the expanded row's exact strings", () => {
  const NOW = Date.parse("2026-01-02T00:00:00.000Z");
  it("packs A as 5/8 failures, 62.5% fail rate, error+age, red breaker", () => {
    const combo = pickComboEntry(seedPayload(), "my-combo");
    const a = combo.members.find((m) => m.member === "A");
    const view = memberRowView({ ...a, lastErrorAt: new Date(NOW - 3 * 3600_000).toISOString() }, NOW);
    expect(view.failRatio).toBe("5/8");
    expect(view.failPct).toBe("62.5%");
    expect(view.errorText).toBe("error:503 · há 3h");
    expect(view.breakerColor).toBe("#ef4444");
    expect(view.attempts).toBe(8);
  });
  it("shows — for a member with no error and no data", () => {
    const view = memberRowView({ member: "C", attempts: 0, failures: 0, failureRate: null, lastErrorStatus: null }, NOW);
    expect(view.errorText).toBe("—");
    expect(view.failPct).toBe("—");
  });
});

describe("buildComboSuccessMap — one source for the Usage-by-Combo column", () => {
  it("maps combo name to the server successRate (null kept as null)", () => {
    const map = buildComboSuccessMap(seedPayload());
    expect(map["my-combo"]).toBe(0.625);
    expect(map["fresh-combo"]).toBeNull();
  });
  it("returns an empty map for a missing payload (column → —, fail-open)", () => {
    expect(buildComboSuccessMap(null)).toEqual({});
  });
});

describe("loadComboStats — FAIL-OPEN, never throws on a dead endpoint", () => {
  it("resolves to error state when the fetch promise rejects", async () => {
    const rejecting = () => Promise.reject(new Error("network down"));
    const result = await loadComboStats("24h", rejecting);
    expect(result).toEqual({ data: null, error: true });
  });
  it("resolves to error state on a non-2xx response", async () => {
    const notFound = () => Promise.resolve({ ok: false, status: 500 });
    const result = await loadComboStats("24h", notFound);
    expect(result.error).toBe(true);
    expect(result.data).toBeNull();
  });
  it("returns the payload on success and never fabricates combos", async () => {
    const seed = seedPayload();
    const ok = () => Promise.resolve({ ok: true, json: () => Promise.resolve(seed) });
    const result = await loadComboStats("24h", ok);
    expect(result.error).toBe(false);
    expect(chipLabel(pickComboEntry(result.data, "my-combo"))).toBe("62.5%");
    // A failed fetch feeds the SAME chain: null data → chip "—", no throw.
    const dead = await loadComboStats("24h", () => Promise.reject(new Error("boom")));
    expect(chipLabel(pickComboEntry(dead.data, "my-combo"))).toBe("—");
  });
});
