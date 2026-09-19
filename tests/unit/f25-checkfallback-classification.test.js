// F25 / RH2 — honest classification in checkFallbackError.
// An error caused by the REQUEST itself (400/406/413/422) must NOT trigger
// account fallback and must NOT lock any account: every account would return
// the same deterministic error, and locking them all turns a 400 into a
// self-inflicted combo-wide 503 (docs/orchestration/findings/T1.1.md, RH2).
import { beforeEach, describe, expect, it, vi } from "vitest";

import { checkFallbackError } from "../../open-sse/services/accountFallback.js";

describe("checkFallbackError — request-caused errors do not fallback (RH2)", () => {
  it("400 context_length_exceeded (blown context) → no fallback, no cooldown", () => {
    expect(
      checkFallbackError(400, "context_length_exceeded: this model's maximum context length is 8192 tokens")
    ).toEqual({ shouldFallback: false, cooldownMs: 0 });
  });

  it.each([
    [400, "Invalid 'messages': expected a non-empty array"],
    [406, "Model not supported"],
    [413, "request body too large"],
    [422, "Unprocessable entity"],
  ])("%i → no fallback, no cooldown", (status, text) => {
    expect(checkFallbackError(status, text)).toEqual({ shouldFallback: false, cooldownMs: 0 });
  });

  it("401 is NOT decided here: no fallback, no lock (delegated to the token-refresh flow)", () => {
    expect(checkFallbackError(401, "Invalid API key provided")).toEqual({ shouldFallback: false, cooldownMs: 0 });
  });

  it("429 → fallback with exponential backoff cooldown", () => {
    const r = checkFallbackError(429, "rate limit exceeded", 0);
    expect(r.shouldFallback).toBe(true);
    expect(r.cooldownMs).toBeGreaterThan(0);
    expect(r.newBackoffLevel).toBe(1);
  });

  it.each([
    [500, "Internal Server Error"],
    [503, "Service temporarily unavailable"],
  ])("%i → fallback with transient cooldown", (status, text) => {
    const r = checkFallbackError(status, text);
    expect(r.shouldFallback).toBe(true);
    expect(r.cooldownMs).toBeGreaterThan(0);
  });

  it("timeout / network failures (no HTTP status) → fallback with transient cooldown", () => {
    for (const [status, text] of [[0, "timeout of 60000ms exceeded"], [null, "fetch failed"]]) {
      const r = checkFallbackError(status, text);
      expect(r.shouldFallback, `${status}/${text}`).toBe(true);
      expect(r.cooldownMs).toBeGreaterThan(0);
    }
  });

  it("404 model-not-found keeps today's behaviour (fallback + per-model 2-min lock)", () => {
    expect(checkFallbackError(404, "The model `gpt-9` does not exist")).toEqual({
      shouldFallback: true,
      cooldownMs: 120000,
    });
  });
});

// ── Integration: the real auth.js call-site that locks accounts (RH2 cascade) ──
// Mirrors tests/unit/github-monthly-usage-lock.test.js mock surface so the REAL
// markAccountUnavailable (and therefore the REAL checkFallbackError) runs.
const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", () => dbMocks);
vi.mock("@/lib/network/connectionProxy", () => ({
  pickProxyPoolId: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

describe("markAccountUnavailable call-site — a 400 must not lock any combo account (RH2)", () => {
  const ACCOUNTS = [
    { id: "acc-1", provider: "openai", name: "acc-1", backoffLevel: 0 },
    { id: "acc-2", provider: "openai", name: "acc-2", backoffLevel: 0 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getProviderConnections.mockResolvedValue(ACCOUNTS);
    dbMocks.updateProviderConnection.mockResolvedValue(undefined);
  });

  // chat.js's account loop continues to the next account ONLY while
  // markAccountUnavailable(...).shouldFallback is true; otherwise it returns the
  // original upstream error response to the client.
  async function simulateChatAccountLoop(status, errorText, provider, model) {
    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    let tried = 0;
    let propagated = null;
    for (const acc of ACCOUNTS) {
      tried++;
      const { shouldFallback } = await markAccountUnavailable(acc.id, status, errorText, provider, model);
      if (!shouldFallback) {
        propagated = { status, errorText, tried };
        break;
      }
    }
    return { tried, propagated };
  }

  it("400 blown context: no DB lock written for either account; original error propagates after the first account", async () => {
    const { tried, propagated } = await simulateChatAccountLoop(
      400,
      "context_length_exceeded: this model's maximum context length is 8192 tokens",
      "openai",
      "gpt-4o"
    );
    expect(propagated, "error must propagate, not exhaust the combo").toEqual({
      status: 400,
      errorText: expect.any(String),
      tried: 1,
    });
    expect(tried).toBe(1);
    expect(dbMocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("406 model-not-supported behaves the same (no lock, no second account)", async () => {
    const { tried } = await simulateChatAccountLoop(406, "Model not supported", "openai", "gpt-4o");
    expect(tried).toBe(1);
    expect(dbMocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("401 does not lock the account here (refresh flow owns it)", async () => {
    const { tried } = await simulateChatAccountLoop(401, "Invalid API key provided", "openai", "gpt-4o");
    expect(tried).toBe(1);
    expect(dbMocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("429 still falls back and locks (behavior preserved for destination errors)", async () => {
    const { tried, propagated } = await simulateChatAccountLoop(429, "rate limit exceeded", "openai", "gpt-4o");
    expect(propagated).toBeNull();
    expect(tried).toBe(ACCOUNTS.length);
    expect(dbMocks.updateProviderConnection).toHaveBeenCalledTimes(ACCOUNTS.length);
  });
});
