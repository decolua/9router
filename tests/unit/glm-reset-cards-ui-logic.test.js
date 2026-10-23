import { describe, expect, it } from "vitest";
import { normalizeResetCard, getResetCardTypeLabel, isResetCardExpired, classifyResetPostOutcome, readPendingResetAttempt, savePendingResetAttempt, clearPendingResetAttempt } from "@/app/(dashboard)/dashboard/usage/components/ProviderLimits/glmResetCardsLogic.js";

const key = "9router:resetCardPending:c1";
const card = (extra = {}) => normalizeResetCard({ recordId: 42, type: "FIVE_HOUR", expiresAt: "2099-01-01T00:00:00Z", ...extra });
const storage = () => {
  const entries = new Map();
  return { getItem: (key) => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value), removeItem: (key) => entries.delete(key) };
};

describe("GLM selection and local recovery", () => {
  it("keeps type and canonical record ID distinct", () => {
    expect(card().id).toBe("FIVE_HOUR:42");
    expect(card({ type: "WEEK" }).id).toBe("WEEK:42");
    expect(card({ recordId: 0 }).recordId).toBe(0);
    expect(card({ recordId: "r-7", type: "WEEK" }).id).toBe("WEEK:r-7");
    expect(getResetCardTypeLabel("FIVE_HOUR")).toBe("5-hour window");
    expect(getResetCardTypeLabel("WEEK")).toBe("Weekly");
  });
  it.each([{ type: "MONTH" }, { type: undefined }, { recordId: "" }, { recordId: "  " }, { recordId: NaN }, { recordId: 1.5 }, { recordId: Number.MAX_SAFE_INTEGER + 1 }, { recordId: true }, { recordId: undefined }])("rejects invalid card %j", (extra) => {
    expect(card(extra)).toBeNull();
    expect(normalizeResetCard(null)).toBeNull();
  });
  it("fails closed on expiry and expires at the exact boundary", () => {
    const now = Date.parse("2026-10-23T12:00:00Z");
    for (const value of [null, undefined, "not-a-date", new Date(now - 1).toISOString(), new Date(now).toISOString()]) expect(isResetCardExpired(value, now)).toBe(true);
    expect(isResetCardExpired(new Date(now + 1).toISOString(), now)).toBe(false);
  });
  it("accepts only unambiguous successful reset", () => {
    expect(classifyResetPostOutcome({ ok: true, payload: { reset: true, message: "done" } })).toEqual({ kind: "success", message: "done" });
  });
  it.each([400, 401, 403, 404, 409, 429, 500, 502])("retains uncertainty after HTTP %s even if the server calls it known", (status) => {
    expect(classifyResetPostOutcome({ ok: false, payload: { uncertain: false, code: status, error: "rejected" } }).kind).toBe("uncertain");
  });
  it.each([null, {}, { reset: false }, { reset: true, uncertain: true }, { reset: true, alreadyUsed: true }, { alreadyUsed: true }])("retains uncertainty for malformed success %j", (payload) => {
    expect(classifyResetPostOutcome({ ok: true, payload }).kind).toBe("uncertain");
  });
  it("persists exact identity per connection, retaining expired attempts for verification", () => {
    const store = storage();
    const attempt = { provider: "glm", card: card({ expiresAt: "2000-01-01T00:00:00Z" }), startedAt: "2026-10-23T10:00:00Z" };
    expect(savePendingResetAttempt(store, "c1", attempt)).toBe(true);
    expect(JSON.parse(store.getItem(key))).toEqual(attempt);
    expect(readPendingResetAttempt(store, "c1")).toEqual({ status: "ok", attempt });
    expect(readPendingResetAttempt(store, "c2").status).toBe("none");
    expect(clearPendingResetAttempt(store, "c1")).toBe(true);
    expect(readPendingResetAttempt(store, "c1").status).toBe("none");
  });
  it.each(["{not json", "null", JSON.stringify({ provider: "codex", card: {} }), JSON.stringify({ provider: "glm", card: { type: "WEEK" } })])("never silently discards an unreadable marker: %s", (raw) => {
    const store = storage(); store.setItem(key, raw);
    expect(readPendingResetAttempt(store, "c1").status).toBe("invalid");
    expect(store.getItem(key)).toBe(raw);
  });
  it("fails closed when reads/writes/removal throw or storage is unavailable", () => {
    const bad = { getItem() { throw Error("SecurityError"); }, setItem() { throw Error("QuotaExceededError"); }, removeItem() { throw Error("SecurityError"); } };
    expect(readPendingResetAttempt(bad, "c1").status).toBe("invalid");
    expect(savePendingResetAttempt(bad, "c1", { provider: "glm", card: card() })).toBe(false);
    expect(clearPendingResetAttempt(bad, "c1")).toBe(false);
    expect(savePendingResetAttempt(null, "c1", {})).toBe(false);
    expect(clearPendingResetAttempt(null, "c1")).toBe(false);
  });
});
