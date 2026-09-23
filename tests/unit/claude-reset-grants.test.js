import { describe, it, expect } from "vitest";
import { parseClaudeResetGrants } from "../../open-sse/services/usage/claude.js";

describe("parseClaudeResetGrants", () => {
  it("sums usable grants and picks next_grant_id", () => {
    const r = parseClaudeResetGrants({
      eligible: true,
      next_grant_id: "g2",
      grants: [
        { id: "g1", resets_left: 1, ends_at: "2026-10-01T00:00:00Z" },
        { id: "g2", resets_left: 2, ends_at: "2026-10-22T00:00:00Z", clears: ["five_hour", "seven_day"] },
        { id: "g3", resets_left: 5, paused: true },
      ],
    });
    expect(r).toMatchObject({ availableCount: 3, nextGrantId: "g2", expiresAt: "2026-10-22T00:00:00Z" });
    expect(r.grants.map((g) => g.id)).toEqual(["g1", "g2", "g3"]); // modal lists paused too
    expect(r.grants[1].clears).toEqual(["five_hour", "seven_day"]);
  });
  it("returns null when ineligible or missing", () => {
    expect(parseClaudeResetGrants(undefined)).toBeNull();
    expect(parseClaudeResetGrants({ eligible: false, grants: [] })).toBeNull();
  });
});
