import { afterEach, describe, expect, it, vi } from "vitest";
import { ADAPTIVE_FAILURE_ACTION, classifyAdaptiveFailure } from "../../open-sse/services/accountFallback.js";

const NOW_MS = Date.UTC(2026, 7, 24, 12);
const HOUR_MS = 60 * 60 * 1000;
const failure = (overrides = {}) => ({ status: 500, error: "upstream failed", provider: "freebuff", model: "deepseek/test", selectedPoolId: "pool-1", stage: "chat_submit", provenance: "target_response", resetsAtMs: null, ...overrides });
afterEach(() => vi.useRealTimers());

describe("classifyAdaptiveFailure", () => {
  it.each([
    ["aborts before proxy", failure({ provenance: "client_abort" }), ADAPTIVE_FAILURE_ACTION.TERMINAL],
    ["credentials before quota", failure({ status: 401, error: "invalid credential project quota exceeded", resetsAtMs: NOW_MS + HOUR_MS }), ADAPTIVE_FAILURE_ACTION.CREDENTIAL_FAILURE],
    ["account quota before relay", failure({ status: 429, error: "project quota exceeded", provenance: "relay_internal", resetsAtMs: NOW_MS + HOUR_MS }), ADAPTIVE_FAILURE_ACTION.ACCOUNT_QUOTA_LOCK],
    ["model quota without reset", failure({ status: 429, error: "project quota exceeded" }), ADAPTIVE_FAILURE_ACTION.MODEL_QUOTA_LOCK],
    ["proven pool before transient", failure({ status: 503, provenance: "relay_internal" }), ADAPTIVE_FAILURE_ACTION.POOL_UNFIT],
    ["plain 429 transient", failure({ status: 429, error: "rate limited", selectedPoolId: null }), ADAPTIVE_FAILURE_ACTION.TRANSIENT_RETRY],
    ["unmatched terminal", failure({ status: 418 }), ADAPTIVE_FAILURE_ACTION.TERMINAL]
  ])("selects one action when %s", (_name, input, action) => {
    vi.useFakeTimers(); vi.setSystemTime(NOW_MS);
    expect(classifyAdaptiveFailure(input).action).toBe(action);
  });

  it.each([
    ["valid milliseconds", NOW_MS + HOUR_MS, ADAPTIVE_FAILURE_ACTION.ACCOUNT_QUOTA_LOCK, NOW_MS + HOUR_MS],
    ["seconds", Math.floor((NOW_MS + HOUR_MS) / 1000), ADAPTIVE_FAILURE_ACTION.MODEL_QUOTA_LOCK, NOW_MS + 2000],
    ["ISO", new Date(NOW_MS + HOUR_MS).toISOString(), ADAPTIVE_FAILURE_ACTION.MODEL_QUOTA_LOCK, NOW_MS + 2000],
    ["NaN", Number.NaN, ADAPTIVE_FAILURE_ACTION.MODEL_QUOTA_LOCK, NOW_MS + 2000],
    ["past", NOW_MS - 1, ADAPTIVE_FAILURE_ACTION.MODEL_QUOTA_LOCK, NOW_MS + 2000],
    ["sub-second", NOW_MS + 1000, ADAPTIVE_FAILURE_ACTION.MODEL_QUOTA_LOCK, NOW_MS + 2000],
    ["over seven days", NOW_MS + 8 * 24 * HOUR_MS, ADAPTIVE_FAILURE_ACTION.MODEL_QUOTA_LOCK, NOW_MS + 7 * 24 * HOUR_MS],
    ["latest valid reset", [NOW_MS + HOUR_MS, NOW_MS + 2 * HOUR_MS], ADAPTIVE_FAILURE_ACTION.ACCOUNT_QUOTA_LOCK, NOW_MS + 2 * HOUR_MS],
    ["valid plus over-window", [NOW_MS + HOUR_MS, NOW_MS + 8 * 24 * HOUR_MS], ADAPTIVE_FAILURE_ACTION.ACCOUNT_QUOTA_LOCK, NOW_MS + HOUR_MS]
  ])("normalizes %s", (_name, resetsAtMs, action, expiresAtMs) => {
    vi.useFakeTimers(); vi.setSystemTime(NOW_MS);
    expect(classifyAdaptiveFailure(failure({ status: 429, error: "project quota exceeded", resetsAtMs }))).toMatchObject({ action, expiresAtMs });
  });

  it("ignores spoofed pool scope and caps model resets", () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW_MS);
    expect(classifyAdaptiveFailure(failure({ status: 429, error: "model quota exceeded", poolScoped: { poolId: "spoofed" }, resetsAtMs: NOW_MS + 8 * 24 * HOUR_MS }))).toMatchObject({ action: ADAPTIVE_FAILURE_ACTION.MODEL_QUOTA_LOCK, expiresAtMs: NOW_MS + 7 * 24 * HOUR_MS, poolScoped: null });
  });

  it.each([[401, "invalid credential", "target_response"], [403, "permission denied", "target_response"], [404, "model not found", "target_response"], [429, "rate limited", "target_response"], [402, "billing payment required", "target_response"], [503, "target unavailable", "target_response"], [503, "relay unavailable", "target_response"], [503, "connector failed", "unknown"]])("excludes near-miss %s %s", (status, error, provenance) => {
    vi.useFakeTimers(); vi.setSystemTime(NOW_MS);
    expect([ADAPTIVE_FAILURE_ACTION.ACCOUNT_QUOTA_LOCK, ADAPTIVE_FAILURE_ACTION.MODEL_QUOTA_LOCK, ADAPTIVE_FAILURE_ACTION.POOL_UNFIT]).not.toContain(classifyAdaptiveFailure(failure({ status, error, provenance })).action);
  });

  it("keeps target timeout-like text transient without proven timeout provenance", () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW_MS);
    expect(classifyAdaptiveFailure(failure({ status: 503, error: "target request timeout", provenance: "target_response" })).action).toBe(ADAPTIVE_FAILURE_ACTION.TRANSIENT_RETRY);
  });

  it("redacts literal secrets from actual structured values", () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW_MS);
    const secrets = ["sk-live-actual-secret", "access-actual-secret", "refresh-actual-secret", "bearer-actual-secret", "cookie-actual-secret", "query-actual-secret", "header-actual-secret"];
    const error = { message: "project quota exceeded", url: "https://example.test/path?token=query-actual-secret", apiKey: "sk-live-actual-secret", accessToken: "access-actual-secret", refreshToken: "refresh-actual-secret", Authorization: "Bearer bearer-actual-secret", Cookie: "sid=cookie-actual-secret", nested: [{ headers: { "x-api-key": "header-actual-secret" } }] };
    const result = classifyAdaptiveFailure(failure({ status: 429, error, resetsAtMs: NOW_MS + HOUR_MS }));
    expect(result.reason.length).toBeLessThanOrEqual(256);
    expect(result.reason).not.toMatch(/[\r\n\u0000-\u001f]/);
    for (const secret of secrets) expect(result.reason).not.toContain(secret);
  });

  it.each([undefined, Symbol("failure"), () => "failure", (() => { const circular = {}; circular.self = circular; return circular; })()])("never throws for malformed error input", error => {
    vi.useFakeTimers(); vi.setSystemTime(NOW_MS);
    expect(() => classifyAdaptiveFailure(failure({ error }))).not.toThrow();
  });
});
