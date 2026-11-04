// Issue #5359: quota exhaustion must lock the account (not just the model)
// until the provider reset time, a manual date/time, or forever (indefinite).
import { describe, expect, it } from "vitest";
import {
  detectQuotaExhaustion,
  isQuotaLockoutActive,
  buildQuotaLockoutUpdate,
  clearQuotaLockoutUpdate,
  filterAvailableAccounts,
} from "../../open-sse/services/accountFallback.js";

describe("detectQuotaExhaustion", () => {
  it.each([
    [200, "Free usage limit reached"],
    [200, "Daily free quota exceeded"],
    [403, "Your free quota has been exhausted"],
    [429, "quota exceeded"],
    [400, "Quota resets at 2026-10-31T00:00:00Z — free quota exhausted"],
  ])("detects free-tier quota errors on HTTP %s", (status, message) => {
    const result = detectQuotaExhaustion(status, message);
    expect(result.exhausted).toBe(true);
  });

  it("does not treat ordinary rate limits as quota exhaustion", () => {
    expect(detectQuotaExhaustion(429, "rate limit, slow down").exhausted).toBe(false);
    expect(detectQuotaExhaustion(500, "boom").exhausted).toBe(false);
    expect(detectQuotaExhaustion(200, null).exhausted).toBe(false);
  });

  it("extracts provider reset timestamps from JSON fields", () => {
    for (const field of ["resetAt", "reset_at", "resets_at", "resetsAtMs"]) {
      const futureMs = Date.now() + 86400000 * 30;
      const body = JSON.stringify({ error: { message: "free quota exhausted" }, [field]: field === "resetsAtMs" ? futureMs : new Date(futureMs).toISOString() });
      const result = detectQuotaExhaustion(403, body);
      expect(result.exhausted).toBe(true);
      expect(result.resetAtMs).toBe(futureMs);
    }
  });

  it("extracts timestamps embedded in the error message", () => {
    const reset = new Date(Date.now() + 86400000 * 30).toISOString();
    const result = detectQuotaExhaustion(200, "Quota resets at " + reset);
    expect(result.resetAtMs).toBe(Date.parse(reset));
  });

  it("ignores stale or unparsable reset times in the past/present", () => {
    const result = detectQuotaExhaustion(403, "quota exhausted, resetAt June 2020");
    expect(result.exhausted).toBe(true);
    expect(result.resetAtMs ?? null).toBe(null);
  });
});

describe("quota lockout state", () => {
  it("is active until the reset time, then auto-reactivates", () => {
    const conn = buildQuotaLockoutFor({ reactivateAt: new Date(Date.now() + 1000).toISOString() });
    expect(isQuotaLockoutActive(conn)).toBe(true);
    expect(isQuotaLockoutActive({ quotaLockout: { status: "quota_exhausted", reactivateAt: new Date(Date.now() - 1000).toISOString() } })).toBe(false);
  });

  it("indefinite lockout (null reactivateAt) never expires", () => {
    const conn = buildQuotaLockoutFor({ reactivateAt: null });
    expect(isQuotaLockoutActive(conn)).toBe(true);
  });

  it("build/clear update shapes round-trip the lockout", () => {
    const update = buildQuotaLockoutUpdate({ status: 403, message: "free quota exhausted", resetAtMs: 123, source: "manual", reactivateAt: "2026-11-02T00:00:00.000Z" });
    expect(update.quotaLockout.status).toBe("quota_exhausted");
    expect(update.quotaLockout.source).toBe("manual");
    expect(clearQuotaLockoutUpdate().quotaLockout).toBe(null);
  });

  it("filterAvailableAccounts excludes quota-locked accounts", () => {
    const locked = { id: "a", ...buildQuotaLockoutFor({ reactivateAt: null }) };
    const ok = { id: "b" };
    expect(filterAvailableAccounts([locked, ok]).map((a) => a.id)).toEqual(["b"]);
  });
});

function buildQuotaLockoutFor({ reactivateAt }) {
  const update = buildQuotaLockoutUpdate({
    status: 403,
    message: "free quota exhausted",
    resetAtMs: reactivateAt ? new Date(reactivateAt).getTime() : null,
    source: "auto",
    reactivateAt,
  });
  return { quotaLockout: update.quotaLockout };
}
