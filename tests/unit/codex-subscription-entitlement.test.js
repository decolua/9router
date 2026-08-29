import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

function makeJwt(payload) {
  const h = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const p = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${h}.${p}.sig`;
}

function isoNowPlus(days) {
  return new Date(Date.now() + days * 86400000).toISOString();
}

describe("getCodexSubscriptionEntitlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.proxyAwareFetch.mockReset();
  });

  it("nested chatgpt_subscription_active_until wins (ISO) and avoids network even with force", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const future = isoNowPlus(10);
    const jwt = makeJwt({ "https://api.openai.com/auth": { chatgpt_subscription_active_until: future } });
    const res = await getCodexSubscriptionEntitlement({
      accessToken: "at",
      idToken: jwt,
      providerSpecificData: {},
      proxyOptions: { connectionProxyEnabled: false },
      force: true,
      now: Date.now(),
    });
    expect(res.subscriptionActiveUntil).toBe(new Date(future).toISOString());
    expect(res.subscriptionSource).toBeTruthy();
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
    expect(res.patch.codexSubscriptionActiveUntil).toBe(res.subscriptionActiveUntil);
  });

  it("top-level chatgpt_subscription_active_until wins", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const future = isoNowPlus(5);
    const jwt = makeJwt({ chatgpt_subscription_active_until: future });
    const res = await getCodexSubscriptionEntitlement({
      accessToken: "at",
      idToken: jwt,
      providerSpecificData: {},
      proxyOptions: null,
      now: Date.now(),
    });
    expect(res.subscriptionActiveUntil).toBe(new Date(future).toISOString());
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("ignores generic exp and quota expiry, falls through to network", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const jwt = makeJwt({ exp: Math.floor(Date.now() / 1000) + 10000, quota_reset: isoNowPlus(1) });
    mocks.proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        accounts: [{ id: "acc1", is_default: true, entitlement: { subscription_plan: "plus", expires_at: isoNowPlus(2) } }],
      }),
    });
    const res = await getCodexSubscriptionEntitlement({
      accessToken: "at",
      idToken: jwt,
      providerSpecificData: {},
      proxyOptions: { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy" },
      now: Date.now(),
    });
    expect(mocks.proxyAwareFetch).toHaveBeenCalled();
    expect(res.subscriptionActiveUntil).toBeTruthy();
  });

  it("normalizes epoch seconds and ms from JWT claim", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const seconds = Math.floor(Date.now() / 1000) + 86400;
    const ms = Date.now() + 86400000;
    const jwtSec = makeJwt({ chatgpt_subscription_active_until: seconds });
    const jwtMs = makeJwt({ chatgpt_subscription_active_until: ms });
    const r1 = await getCodexSubscriptionEntitlement({ accessToken: "a", idToken: jwtSec, providerSpecificData: {}, now: Date.now() });
    const r2 = await getCodexSubscriptionEntitlement({ accessToken: "a", idToken: jwtMs, providerSpecificData: {}, now: Date.now() });
    expect(r1.subscriptionActiveUntil).toBe(new Date(seconds * 1000).toISOString());
    expect(r2.subscriptionActiveUntil).toBe(new Date(ms).toISOString());
  });

  it("selects org ID via nested claim > providerSpecificData > default > non-free > first", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const accounts = [
      { id: "free1", plan_type: "free", is_default: false, entitlement: { subscription_plan: "free", expires_at: isoNowPlus(1) } },
      { id: "paid1", plan_type: "plus", is_default: true, entitlement: { subscription_plan: "plus", expires_at: isoNowPlus(10) } },
      { id: "paid2", plan_type: "pro", is_default: false, entitlement: { subscription_plan: "pro", expires_at: isoNowPlus(20) } },
    ];
    mocks.proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ accounts }),
    });
    const res = await getCodexSubscriptionEntitlement({
      accessToken: "at",
      idToken: null,
      providerSpecificData: { chatgptAccountId: "paid2" },
      proxyOptions: null,
      now: Date.now(),
    });
    // Should prefer providerSpecificData chatgptAccountId if explicit; but default also present.
    // Priority: explicit nested/providerSpecificData first, so paid2 wins over default paid1
    expect(res.subscriptionPlan).toBe("pro");
    expect(res.subscriptionActiveUntil).toBe(new Date(accounts[2].entitlement.expires_at).toISOString());
  });

  it("fallback to /subscriptions when entitlement missing/expired", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const accounts = [{ id: "acc1", is_default: true, entitlement: null }];
    const subDate = isoNowPlus(30);
    mocks.proxyAwareFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ accounts }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ subscription_plan: "pro", active_until: subDate }),
      });
    const res = await getCodexSubscriptionEntitlement({
      accessToken: "at",
      idToken: null,
      providerSpecificData: {},
      proxyOptions: null,
      now: Date.now(),
    });
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(res.subscriptionActiveUntil).toBe(new Date(subDate).toISOString());
    expect(res.subscriptionPlan).toBe("pro");
    expect(res.subscriptionSource).toMatch(/subscriptions/i);
  });

  it("parses accounts as array or object robustly and selects non-free then first", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const accountsObj = {
      acc1: { id: "acc1", plan_type: "free", entitlement: { subscription_plan: "free", expires_at: isoNowPlus(1) } },
      acc2: { id: "acc2", plan_type: "plus", entitlement: { subscription_plan: "plus", expires_at: isoNowPlus(5) } },
    };
    mocks.proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ accounts: accountsObj }),
    });
    const res = await getCodexSubscriptionEntitlement({
      accessToken: "at",
      idToken: null,
      providerSpecificData: {},
      proxyOptions: null,
      now: Date.now(),
    });
    expect(res.subscriptionPlan).toBe("plus");
  });

  it("forwards proxyOptions exactly and queries timezone_offset_min", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const proxyOpts = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.local", connectionNoProxy: "", vercelRelayUrl: "", strictProxy: false };
    mocks.proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ accounts: [{ id: "a1", is_default: true, entitlement: { subscription_plan: "plus", expires_at: isoNowPlus(3) } }] }),
    });
    await getCodexSubscriptionEntitlement({ accessToken: "tok123", idToken: null, providerSpecificData: {}, proxyOptions: proxyOpts, now: Date.now() });
    const [url, opts, passedProxy] = mocks.proxyAwareFetch.mock.calls[0];
    expect(url).toContain("timezone_offset_min");
    expect(opts.headers.Authorization).toBe("Bearer tok123");
    expect(opts.headers.Accept).toMatch(/application\/json/i);
    expect(passedProxy).toEqual(proxyOpts);
    expect(passedProxy).toBe(proxyOpts);
  });

  it("fail-open on network error, non-2xx, malformed json keeps last-known-good", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const prev = {
      codexSubscriptionActiveUntil: isoNowPlus(10),
      codexSubscriptionPlan: "plus",
      codexSubscriptionSource: "accounts",
      codexSubscriptionFetchedAt: new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(),
      codexSubscriptionAttemptAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    };
    mocks.proxyAwareFetch.mockRejectedValueOnce(new Error("network down"));
    const res = await getCodexSubscriptionEntitlement({
      accessToken: "at",
      idToken: null,
      providerSpecificData: { ...prev },
      proxyOptions: null,
      now: Date.now(),
    });
    expect(res.subscriptionActiveUntil).toBe(prev.codexSubscriptionActiveUntil);
    expect(res.subscriptionPlan).toBe("plus");
    expect(res.patch.codexSubscriptionActiveUntil).toBeUndefined();
    expect(res.patch.codexSubscriptionAttemptAt).toBeTruthy();
    // no throw
    expect(res).toHaveProperty("subscriptionActiveUntil");
  });

  it("non-2xx also fail-open", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    mocks.proxyAwareFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const res = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: null, providerSpecificData: {}, proxyOptions: null, now: Date.now() });
    expect(res.subscriptionActiveUntil).toBeNull();
    expect(res.patch.codexSubscriptionAttemptAt).toBeTruthy();
  });

  it("cache 6h success TTL avoids network", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const now = Date.now();
    const fetchedAt = new Date(now - 2 * 60 * 60 * 1000).toISOString();
    const psd = {
      codexSubscriptionActiveUntil: isoNowPlus(10),
      codexSubscriptionPlan: "pro",
      codexSubscriptionSource: "accounts",
      codexSubscriptionFetchedAt: fetchedAt,
      codexSubscriptionAttemptAt: fetchedAt,
    };
    const res = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: null, providerSpecificData: psd, proxyOptions: null, now });
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
    expect(res.subscriptionActiveUntil).toBe(psd.codexSubscriptionActiveUntil);
  });

  it("failed-attempt retry 30m avoids network when recent failure", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const now = Date.now();
    const attemptAt = new Date(now - 10 * 60 * 1000).toISOString();
    const psd = { codexSubscriptionAttemptAt: attemptAt, codexSubscriptionActiveUntil: isoNowPlus(5), codexSubscriptionPlan: "plus", codexSubscriptionSource: "accounts" };
    // No recent fetchedAt, but recent attemptAt -> should not fetch
    mocks.proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ accounts: [{ id: "a", entitlement: { subscription_plan: "plus", expires_at: isoNowPlus(10) } }] }),
    });
    const res = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: null, providerSpecificData: psd, proxyOptions: null, now });
    // Should avoid network because within 30m retry window and no force
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
    expect(res.subscriptionActiveUntil).toBe(psd.codexSubscriptionActiveUntil);
  });

  it("force bypasses 6h and 30m caches but not valid JWT claim", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const now = Date.now();
    const fetchedAt = new Date(now - 1000).toISOString();
    const psd = {
      codexSubscriptionActiveUntil: isoNowPlus(10),
      codexSubscriptionPlan: "plus",
      codexSubscriptionSource: "accounts",
      codexSubscriptionFetchedAt: fetchedAt,
      codexSubscriptionAttemptAt: fetchedAt,
    };
    mocks.proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ accounts: [{ id: "a", entitlement: { subscription_plan: "pro", expires_at: isoNowPlus(20) } }] }),
    });
    const res = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: null, providerSpecificData: psd, proxyOptions: null, force: true, now });
    expect(mocks.proxyAwareFetch).toHaveBeenCalled();
    expect(res.subscriptionPlan).toBe("pro");
    // JWT claim still wins even with force
    const jwt = makeJwt({ chatgpt_subscription_active_until: isoNowPlus(15) });
    mocks.proxyAwareFetch.mockClear();
    const r2 = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: jwt, providerSpecificData: psd, proxyOptions: null, force: true, now });
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("never returns token or raw payload in result or throw", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const token = "sk-secret-token-123";
    mocks.proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ accounts: [{ id: "a", entitlement: { subscription_plan: "plus", expires_at: isoNowPlus(5) }, raw_secret: "should-not-leak" }] }),
    });
    const res = await getCodexSubscriptionEntitlement({ accessToken: token, idToken: makeJwt({ chatgpt_subscription_active_until: isoNowPlus(5) }), providerSpecificData: {}, proxyOptions: null, now: Date.now() });
    const str = JSON.stringify(res);
    expect(str).not.toContain(token);
    expect(str).not.toContain("raw_secret");
    expect(str).not.toContain("sk-secret");
  });


  it("handles numeric-string epoch seconds and milliseconds for JWT claim", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const secStr = String(Math.floor(Date.now() / 1000) + 86400);
    const msStr = String(Date.now() + 86400000);
    const jwtSecStr = makeJwt({ chatgpt_subscription_active_until: secStr });
    const jwtMsStr = makeJwt({ chatgpt_subscription_active_until: msStr });
    const r1 = await getCodexSubscriptionEntitlement({ accessToken: "a", idToken: jwtSecStr, providerSpecificData: {}, now: Date.now() });
    const r2 = await getCodexSubscriptionEntitlement({ accessToken: "a", idToken: jwtMsStr, providerSpecificData: {}, now: Date.now() });
    expect(r1.subscriptionActiveUntil).toBe(new Date(Number(secStr) * 1000).toISOString());
    expect(r2.subscriptionActiveUntil).toBe(new Date(Number(msStr)).toISOString());
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("prefers organizationId over accountId and distinguishes personal Free vs paid org", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const accounts = [
      { id: "personal_free", organization_id: "org_personal", plan_type: "free", entitlement: { subscription_plan: "free", expires_at: isoNowPlus(1) } },
      { id: "org_paid", organization_id: "org_999", plan_type: "pro", entitlement: { subscription_plan: "pro", expires_at: isoNowPlus(20) } },
    ];
    // JWT has nested organization_id pointing to paid org, even if providerSpecificData accountId points to free
    const jwt = makeJwt({ "https://api.openai.com/auth": { organization_id: "org_999", chatgpt_account_id: "personal_free" } });
    mocks.proxyAwareFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ accounts }) });
    const res = await getCodexSubscriptionEntitlement({
      accessToken: "at",
      idToken: jwt,
      providerSpecificData: { chatgptAccountId: "personal_free", organizationId: "org_personal" },
      proxyOptions: null,
      now: Date.now(),
    });
    expect(res.subscriptionPlan).toBe("pro");
    expect(res.subscriptionActiveUntil).toBe(new Date(accounts[1].entitlement.expires_at).toISOString());
    expect(res.subscriptionSource).toBe("accounts");
  });

  it("supports providerSpecificData organizationId/chatgptOrganizationId and matches workspace_id", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const accounts = [
      { id: "a_free", workspace_id: "ws_free", plan_type: "free", entitlement: { subscription_plan: "free", expires_at: isoNowPlus(1) } },
      { id: "a_paid", workspace_id: "ws_paid", plan_type: "team", entitlement: { subscription_plan: "team", expires_at: isoNowPlus(15) } },
    ];
    mocks.proxyAwareFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ accounts }) });
    const res = await getCodexSubscriptionEntitlement({
      accessToken: "at",
      idToken: null,
      providerSpecificData: { chatgptOrganizationId: "ws_paid" },
      proxyOptions: null,
      now: Date.now(),
    });
    expect(res.subscriptionPlan).toBe("team");
  });

  it("subscriptions fallback non-2xx preserves accounts snapshot expiry (fail-open)", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const validExpiry = isoNowPlus(10);
    const accounts = [{ id: "acc1", is_default: true, entitlement: { subscription_plan: "pro", expires_at: validExpiry } }];
    mocks.proxyAwareFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ accounts }) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    // Force subscription fallback by making isExpired false but we still want to test non-2xx path:
    // To trigger fallback, make accounts expired so subscriptions is attempted and fails, but snapshot should be returned.
    // So use expired accounts then fallback, but if fallback fails we still return last-known-good; to test snapshot path, we need valid accounts snapshot that wouldn't trigger fallback.
    // Instead test: expired accounts + subscriptions non-2xx -> snapshot valid is not used; but we test valid snapshot preserved when subscriptions called and fails.
    // We'll make accounts with expired expiry and also set plan, then mock subscription to non-2xx, but code should fallback to snapshot if snapshot had valid expiry? Actually expired means snapshot invalid, so fallback won't help.
    // Instead we test case where subscriptions is not called for valid snapshot: verify that when subscriptions is attempted due to missing plan but accounts snapshot is valid, non-2xx preserves snapshot.
    // Simpler: accounts has valid plan+expiry, but we force subscription attempt by mocking expired via missing plan, then subscription fails -> should still return accounts expiry if we had one.
    // We'll directly test the snapshot logic by having an expired plan trigger but accounts still had expiry before, now patched to preserve.
    const accWithExpiry = { id: "acc2", is_default: true, plan_type: "free", entitlement: { subscription_plan: null, expires_at: validExpiry } };
    mocks.proxyAwareFetch.mockReset();
    mocks.proxyAwareFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ accounts: [accWithExpiry] }) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    const res = await getCodexSubscriptionEntitlement({
      accessToken: "at",
      idToken: null,
      providerSpecificData: { chatgptAccountId: "acc2" },
      proxyOptions: null,
      now: Date.now(),
    });
    expect(res.subscriptionActiveUntil).toBe(new Date(validExpiry).toISOString());
    expect(res.subscriptionSource).toBe("accounts");
  });

  it("subscriptions network error preserves accounts snapshot expiry", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const validExpiry = isoNowPlus(12);
    const acc = { id: "acc3", is_default: true, plan_type: "free", entitlement: { subscription_plan: null, expires_at: validExpiry } };
    mocks.proxyAwareFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ accounts: [acc] }) })
      .mockRejectedValueOnce(new Error("network down"));
    const res = await getCodexSubscriptionEntitlement({
      accessToken: "at",
      idToken: null,
      providerSpecificData: {},
      proxyOptions: null,
      now: Date.now(),
    });
    expect(res.subscriptionActiveUntil).toBe(new Date(validExpiry).toISOString());
    expect(res.subscriptionSource).toBe("accounts");
  });
  it("repeated valid idToken same expiry/plan with fresh fetchedAt does not request patch or network", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const now = Date.now();
    const future = new Date(now + 10 * 86400000).toISOString();
    const jwt = makeJwt({ "https://api.openai.com/auth": { chatgpt_subscription_active_until: future, chatgpt_plan_type: "plus" } });
    const freshAt = new Date(now - 60 * 1000).toISOString();
    const psd = {
      codexSubscriptionActiveUntil: future,
      codexSubscriptionPlan: "plus",
      codexSubscriptionSource: "idToken",
      codexSubscriptionFetchedAt: freshAt,
      codexSubscriptionAttemptAt: freshAt,
    };
    const res = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: jwt, providerSpecificData: psd, proxyOptions: null, now });
    expect(res.subscriptionActiveUntil).toBe(future);
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
    // idempotent: same metadata within TTL must not trigger DB patch
    expect(Object.keys(res.patch || {}).length).toBe(0);
  });

  it("same valid idToken after 6h may refresh fetchedAt once", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const baseNow = Date.now();
    const future = new Date(baseNow + 10 * 86400000).toISOString();
    const jwt = makeJwt({ "https://api.openai.com/auth": { chatgpt_subscription_active_until: future, chatgpt_plan_type: "plus" } });
    const staleAt = new Date(baseNow - 6 * 60 * 60 * 1000 - 1000).toISOString();
    const psd = {
      codexSubscriptionActiveUntil: future,
      codexSubscriptionPlan: "plus",
      codexSubscriptionSource: "idToken",
      codexSubscriptionFetchedAt: staleAt,
      codexSubscriptionAttemptAt: staleAt,
    };
    const res = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: jwt, providerSpecificData: psd, proxyOptions: null, now: baseNow });
    expect(res.subscriptionActiveUntil).toBe(future);
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
    expect(res.patch.codexSubscriptionFetchedAt).toBeTruthy();
  });

  it("uses provider registry via U('codex') not hardcoded endpoint", async () => {
    const { U } = await import("../../open-sse/services/usage/shared.js");
    expect(U("codex").accountsCheckUrl).toBe("https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27");
    expect(U("codex").subscriptionsUrl).toBe("https://chatgpt.com/backend-api/subscriptions");
  });

  // RED: past network-derived expiry handling
  it("past /subscriptions expiry is rejected, not returned or persisted (falls back to null when no future snapshot/cache)", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const past = isoNowPlus(-10);
    mocks.proxyAwareFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ accounts: [{ id: "acc1", is_default: true, entitlement: null }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ subscription_plan: "pro", active_until: past }),
      });
    const res = await getCodexSubscriptionEntitlement({
      accessToken: "at",
      idToken: null,
      providerSpecificData: {},
      proxyOptions: null,
      now: Date.now(),
    });
    expect(res.subscriptionActiveUntil).toBeNull();
    expect(res.patch.codexSubscriptionActiveUntil).toBeUndefined();
    // must not persist past source
    expect(res.patch.codexSubscriptionSource).toBeUndefined();
  });

  it("future accounts snapshot beats past /subscriptions fallback", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const future = isoNowPlus(10);
    const past = isoNowPlus(-10);
    const acc = { id: "acc2", is_default: true, plan_type: "free", entitlement: { subscription_plan: null, expires_at: future } };
    mocks.proxyAwareFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ accounts: [acc] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ subscription_plan: "pro", active_until: past }) });
    const res = await getCodexSubscriptionEntitlement({
      accessToken: "at",
      idToken: null,
      providerSpecificData: {},
      proxyOptions: null,
      now: Date.now(),
    });
    expect(res.subscriptionActiveUntil).toBe(new Date(future).toISOString());
    expect(res.subscriptionSource).toBe("accounts");
    expect(res.patch.codexSubscriptionActiveUntil).toBe(new Date(future).toISOString());
  });

  it("future last-known-good cache beats past /subscriptions fallback when accounts snapshot not future", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const past = isoNowPlus(-10);
    const futureCache = isoNowPlus(15);
    const staleAt = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString();
    const psd = {
      codexSubscriptionActiveUntil: futureCache,
      codexSubscriptionPlan: "pro",
      codexSubscriptionSource: "accounts",
      codexSubscriptionFetchedAt: staleAt,
      codexSubscriptionAttemptAt: staleAt,
    };
    mocks.proxyAwareFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ accounts: [{ id: "acc3", is_default: true, entitlement: { subscription_plan: null, expires_at: past } }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ subscription_plan: "pro", active_until: past }) });
    const res = await getCodexSubscriptionEntitlement({
      accessToken: "at",
      idToken: null,
      providerSpecificData: psd,
      proxyOptions: null,
      now: Date.now(),
    });
    expect(res.subscriptionActiveUntil).toBe(new Date(futureCache).toISOString());
    expect(res.subscriptionPlan).toBe("pro");
    // must not persist past
    expect(res.patch.codexSubscriptionActiveUntil).not.toBe(new Date(past).toISOString());
  });

  it("paid non-free workspace beats free default when no org/account hints", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const accounts = [
      { id: "free1", is_default: true, plan_type: "free", entitlement: { subscription_plan: "free", expires_at: isoNowPlus(1) } },
      { id: "paid1", plan_type: "plus", entitlement: { subscription_plan: "plus", expires_at: isoNowPlus(10) } },
      { id: "paid2", plan_type: "pro", entitlement: { subscription_plan: "pro", expires_at: isoNowPlus(20) } },
    ];
    mocks.proxyAwareFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ accounts }) });
    const res = await getCodexSubscriptionEntitlement({
      accessToken: "at",
      idToken: null,
      providerSpecificData: {},
      proxyOptions: null,
      now: Date.now(),
    });
    expect(res.subscriptionPlan).not.toBe("free");
    expect(["plus", "pro"]).toContain(res.subscriptionPlan);
    expect(res.subscriptionActiveUntil).toBeTruthy();
  });

  // REVIEW FIXES RED
  it("fresh 6h cache with past activeUntil must NOT return past (proceeds to network)", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const now = Date.now();
    const past = new Date(now - 86400000).toISOString();
    const future = new Date(now + 10 * 86400000).toISOString();
    const psd = {
      codexSubscriptionActiveUntil: past,
      codexSubscriptionPlan: "pro",
      codexSubscriptionSource: "accounts",
      codexSubscriptionFetchedAt: new Date(now - 60 * 1000).toISOString(),
      codexSubscriptionAttemptAt: new Date(now - 60 * 1000).toISOString(),
    };
    mocks.proxyAwareFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ accounts: [{ id: "a1", is_default: true, entitlement: { subscription_plan: "plus", expires_at: future } }] }),
    });
    const res = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: null, providerSpecificData: psd, proxyOptions: null, now });
    expect(mocks.proxyAwareFetch).toHaveBeenCalled();
    expect(res.subscriptionActiveUntil).toBe(new Date(future).toISOString());
    expect(res.subscriptionActiveUntil).not.toBe(past);
  });

  it("fresh 6h cache with past activeUntil and no future network falls back to null", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const now = Date.now();
    const past = new Date(now - 86400000).toISOString();
    const psd = {
      codexSubscriptionActiveUntil: past,
      codexSubscriptionPlan: "pro",
      codexSubscriptionSource: "accounts",
      codexSubscriptionFetchedAt: new Date(now - 60 * 1000).toISOString(),
      codexSubscriptionAttemptAt: new Date(now - 60 * 1000).toISOString(),
    };
    mocks.proxyAwareFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ accounts: [{ id: "a1", is_default: true, entitlement: { subscription_plan: null, expires_at: past } }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ subscription_plan: "pro", active_until: past }) });
    const res = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: null, providerSpecificData: psd, proxyOptions: null, now });
    expect(res.subscriptionActiveUntil).toBeNull();
    expect(res.patch.codexSubscriptionActiveUntil).toBeUndefined();
  });

  it("fresh 30m attempt cache with past activeUntil must NOT return past", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const now = Date.now();
    const past = new Date(now - 86400000).toISOString();
    const future = new Date(now + 10 * 86400000).toISOString();
    const psd = {
      codexSubscriptionActiveUntil: past,
      codexSubscriptionPlan: "pro",
      codexSubscriptionSource: "accounts",
      codexSubscriptionAttemptAt: new Date(now - 10 * 60 * 1000).toISOString(),
    };
    mocks.proxyAwareFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ accounts: [{ id: "a1", is_default: true, entitlement: { subscription_plan: "plus", expires_at: future } }] }),
    });
    const res = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: null, providerSpecificData: psd, proxyOptions: null, now });
    expect(mocks.proxyAwareFetch).toHaveBeenCalled();
    expect(res.subscriptionActiveUntil).toBe(new Date(future).toISOString());
  });

  it("no accessToken with past cache returns null activeUntil and no past persist", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const now = Date.now();
    const past = new Date(now - 86400000).toISOString();
    const psd = {
      codexSubscriptionActiveUntil: past,
      codexSubscriptionPlan: "pro",
      codexSubscriptionSource: "accounts",
      codexSubscriptionFetchedAt: new Date(now - 60 * 1000).toISOString(),
      codexSubscriptionAttemptAt: new Date(now - 60 * 1000).toISOString(),
    };
    const res = await getCodexSubscriptionEntitlement({ accessToken: null, idToken: null, providerSpecificData: psd, proxyOptions: null, now });
    expect(res.subscriptionActiveUntil).toBeNull();
    expect(res.patch.codexSubscriptionActiveUntil).toBeUndefined();
    expect(res.patch.codexSubscriptionSource).toBeUndefined();
  });

  it("network throw with past cache returns null, future cache preserved", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const now = Date.now();
    const past = new Date(now - 86400000).toISOString();
    const futureCache = new Date(now + 10 * 86400000).toISOString();
    const staleAt = new Date(now - 7 * 60 * 60 * 1000).toISOString();
    const psdPast = {
      codexSubscriptionActiveUntil: past,
      codexSubscriptionPlan: "pro",
      codexSubscriptionSource: "accounts",
      codexSubscriptionFetchedAt: staleAt,
      codexSubscriptionAttemptAt: staleAt,
    };
    mocks.proxyAwareFetch.mockRejectedValueOnce(new Error("network down"));
    const rPast = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: null, providerSpecificData: psdPast, proxyOptions: null, now });
    expect(rPast.subscriptionActiveUntil).toBeNull();
    expect(rPast.patch.codexSubscriptionActiveUntil).toBeUndefined();

    const psdFuture = { ...psdPast, codexSubscriptionActiveUntil: futureCache };
    mocks.proxyAwareFetch.mockRejectedValueOnce(new Error("network down"));
    const rFuture = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: null, providerSpecificData: psdFuture, proxyOptions: null, now });
    expect(rFuture.subscriptionActiveUntil).toBe(futureCache);
  });

  it("expiry exactly nowMs is rejected (strict >)", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const now = Date.now();
    const exact = new Date(now).toISOString();
    const jwt = makeJwt({ chatgpt_subscription_active_until: exact });
    mocks.proxyAwareFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ accounts: [{ id: "a1", is_default: true, entitlement: { subscription_plan: "plus", expires_at: new Date(now + 86400000).toISOString() } }] }),
    });
    const res = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: jwt, providerSpecificData: {}, proxyOptions: null, now });
    expect(mocks.proxyAwareFetch).toHaveBeenCalled();
    expect(res.subscriptionActiveUntil).not.toBe(exact);
  });

  it("rejected past subscriptions plan does not overwrite/persist", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const now = Date.now();
    const past = new Date(now - 86400000).toISOString();
    const future = new Date(now + 10 * 86400000).toISOString();
    const acc = { id: "a1", is_default: true, entitlement: { subscription_plan: "team", expires_at: future } };
    mocks.proxyAwareFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ accounts: [acc] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ subscription_plan: "pro", active_until: past }) });
    // isExpired false so no subscriptions fallback normally; force via missing plan
    const acc2 = { id: "a2", is_default: true, entitlement: { subscription_plan: null, expires_at: future } };
    mocks.proxyAwareFetch.mockReset();
    mocks.proxyAwareFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ accounts: [acc2] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ subscription_plan: "pro", active_until: past }) });
    const res = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: null, providerSpecificData: {}, proxyOptions: null, now });
    expect(res.subscriptionPlan).not.toBe("pro");
    expect(res.subscriptionActiveUntil).toBe(new Date(future).toISOString());
    expect(res.subscriptionSource).toBe("accounts");
  });

  it("paid workspace with top-level plan: 'plus' beats free default", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const accounts = [
      { id: "free1", is_default: true, plan: "free", entitlement: { subscription_plan: "free", expires_at: isoNowPlus(1) } },
      { id: "paid1", plan: "plus", entitlement: { subscription_plan: "plus", expires_at: isoNowPlus(10) } },
    ];
    mocks.proxyAwareFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ accounts }) });
    const res = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: null, providerSpecificData: {}, proxyOptions: null, now: Date.now() });
    expect(res.subscriptionPlan).toBe("plus");
    expect(res.subscriptionActiveUntil).toBeTruthy();
  });
});
