import { describe, it, expect } from "vitest";
import { REFRESH_INTERVAL_MS, CLAUDE_REFRESH_INTERVAL_MS } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

// Locks in the 60s -> 5min cadence relax (backend-load reduction ahead of
// more providers gaining quota tracking). The dashboard's own countdown
// display derives its reset value from REFRESH_INTERVAL_MS directly (see
// ProviderLimits/index.js), so this constant is the single source of truth
// for both the poll cadence and what the visible countdown counts down from.
describe("Provider Limits refresh interval", () => {
  it("defaults to 5 minutes, not the old 60 seconds", () => {
    expect(REFRESH_INTERVAL_MS).toBe(300000);
  });

  it("keeps Claude's effective cadence at 10 minutes via the tick-ratio computation", () => {
    const claudeEvery = Math.round(CLAUDE_REFRESH_INTERVAL_MS / REFRESH_INTERVAL_MS);
    expect(claudeEvery * REFRESH_INTERVAL_MS).toBe(CLAUDE_REFRESH_INTERVAL_MS);
    expect(CLAUDE_REFRESH_INTERVAL_MS).toBe(600000);
  });
});
