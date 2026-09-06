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

function getHeader(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get(name) ?? headers.get(name.toLowerCase());
  const target = name.toLowerCase();
  const key = Object.keys(headers).find((candidate) => candidate.toLowerCase() === target);
  return key ? headers[key] : undefined;
}

describe("getCodexSubscriptionEntitlement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.proxyAwareFetch.mockReset();
  });

  it("nested chatgpt_subscription_active_until wins (ISO) and avoids network when not forced (force bypasses JWT)", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const now = Date.now();
    const future = isoNowPlus(10);
    const jwt = makeJwt({ "https://api.openai.com/auth": { chatgpt_subscription_active_until: future } });
    const normalizedFuture = new Date(future).toISOString();
    const freshAt = new Date(now - 60 * 1000).toISOString();
    const res = await getCodexSubscriptionEntitlement({
      accessToken: "at",
      idToken: jwt,
      providerSpecificData: {
        codexSubscriptionActiveUntil: normalizedFuture,
        codexSubscriptionPlan: null,
        codexSubscriptionSource: "idToken",
        codexSubscriptionFetchedAt: freshAt,
        codexSubscriptionAttemptAt: freshAt,
      },
      proxyOptions: { connectionProxyEnabled: false },
      force: false,
      now,
    });
    expect(res.subscriptionActiveUntil).toBe(normalizedFuture);
    expect(res.subscriptionSource).toBeTruthy();
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
    expect(Object.keys(res.patch || {}).length).toBe(0);
    // with force, JWT fast-path is bypassed and network is used
    const future2 = isoNowPlus(5);
    mocks.proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ accounts: [{ id: "a", entitlement: { subscription_plan: "plus", expires_at: future2 } }] }),
    });
    const r2 = await getCodexSubscriptionEntitlement({
      accessToken: "at",
      idToken: jwt,
      providerSpecificData: {},
      proxyOptions: null,
      force: true,
      now: Date.now(),
    });
    expect(mocks.proxyAwareFetch).toHaveBeenCalled();
    expect(r2.subscriptionSource).toBe("accounts");
  });

  it("top-level chatgpt_subscription_active_until wins", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const now = Date.now();
    const future = isoNowPlus(5);
    const jwt = makeJwt({ chatgpt_subscription_active_until: future });
    const normalizedFuture = new Date(future).toISOString();
    const freshAt = new Date(now - 60 * 1000).toISOString();
    const res = await getCodexSubscriptionEntitlement({
      accessToken: "at",
      idToken: jwt,
      providerSpecificData: {
        codexSubscriptionActiveUntil: normalizedFuture,
        codexSubscriptionPlan: null,
        codexSubscriptionSource: "idToken",
        codexSubscriptionFetchedAt: freshAt,
        codexSubscriptionAttemptAt: freshAt,
      },
      proxyOptions: null,
      now,
    });
    expect(res.subscriptionActiveUntil).toBe(normalizedFuture);
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
    const now = Date.now();
    const seconds = Math.floor(now / 1000) + 86400;
    const ms = now + 86400000;
    const jwtSec = makeJwt({ chatgpt_subscription_active_until: seconds });
    const jwtMs = makeJwt({ chatgpt_subscription_active_until: ms });
    const secIso = new Date(seconds * 1000).toISOString();
    const msIso = new Date(ms).toISOString();
    const freshAt = new Date(now - 60 * 1000).toISOString();
    const psdSec = { codexSubscriptionActiveUntil: secIso, codexSubscriptionPlan: null, codexSubscriptionSource: "idToken", codexSubscriptionFetchedAt: freshAt, codexSubscriptionAttemptAt: freshAt };
    const psdMs = { codexSubscriptionActiveUntil: msIso, codexSubscriptionPlan: null, codexSubscriptionSource: "idToken", codexSubscriptionFetchedAt: freshAt, codexSubscriptionAttemptAt: freshAt };
    const r1 = await getCodexSubscriptionEntitlement({ accessToken: "a", idToken: jwtSec, providerSpecificData: psdSec, now });
    const r2 = await getCodexSubscriptionEntitlement({ accessToken: "a", idToken: jwtMs, providerSpecificData: psdMs, now });
    expect(r1.subscriptionActiveUntil).toBe(secIso);
    expect(r2.subscriptionActiveUntil).toBe(msIso);
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
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

  it("force bypasses 6h and 30m caches and JWT future fast-path", async () => {
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
    // JWT claim is bypassed when force=true (reaches network)
    const jwt = makeJwt({ chatgpt_subscription_active_until: isoNowPlus(15) });
    mocks.proxyAwareFetch.mockClear();
    mocks.proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ accounts: [{ id: "b", entitlement: { subscription_plan: "plus", expires_at: isoNowPlus(12) } }] }),
    });
    const r2 = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: jwt, providerSpecificData: psd, proxyOptions: null, force: true, now });
    expect(mocks.proxyAwareFetch).toHaveBeenCalled();
    expect(r2.subscriptionSource).toBe("accounts");
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
    const now = Date.now();
    const secStr = String(Math.floor(now / 1000) + 86400);
    const msStr = String(now + 86400000);
    const jwtSecStr = makeJwt({ chatgpt_subscription_active_until: secStr });
    const jwtMsStr = makeJwt({ chatgpt_subscription_active_until: msStr });
    const secIso = new Date(Number(secStr) * 1000).toISOString();
    const msIso = new Date(Number(msStr)).toISOString();
    const freshAt = new Date(now - 60 * 1000).toISOString();
    const psdSec = { codexSubscriptionActiveUntil: secIso, codexSubscriptionPlan: null, codexSubscriptionSource: "idToken", codexSubscriptionFetchedAt: freshAt, codexSubscriptionAttemptAt: freshAt };
    const psdMs = { codexSubscriptionActiveUntil: msIso, codexSubscriptionPlan: null, codexSubscriptionSource: "idToken", codexSubscriptionFetchedAt: freshAt, codexSubscriptionAttemptAt: freshAt };
    const r1 = await getCodexSubscriptionEntitlement({ accessToken: "a", idToken: jwtSecStr, providerSpecificData: psdSec, now });
    const r2 = await getCodexSubscriptionEntitlement({ accessToken: "a", idToken: jwtMsStr, providerSpecificData: psdMs, now });
    expect(r1.subscriptionActiveUntil).toBe(secIso);
    expect(r2.subscriptionActiveUntil).toBe(msIso);
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
  });

  it("prefers providerSpecificData organization over stale idToken when accessToken has no hint (Free is valid with null expiry)", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const accounts = [
      { id: "personal_free", organization_id: "org_personal", plan_type: "free", entitlement: { subscription_plan: "free", expires_at: isoNowPlus(1) } },
      { id: "org_paid", organization_id: "org_999", plan_type: "pro", entitlement: { subscription_plan: "pro", expires_at: isoNowPlus(20) } },
    ];
    const staleIdToken = makeJwt({ "https://api.openai.com/auth": { organization_id: "org_999", chatgpt_account_id: "org_paid" } });
    mocks.proxyAwareFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ accounts }) });
    const res = await getCodexSubscriptionEntitlement({
      accessToken: "at",
      idToken: staleIdToken,
      providerSpecificData: { chatgptAccountId: "personal_free", organizationId: "org_personal" },
      proxyOptions: null,
      now: Date.now(),
    });
    expect(res.subscriptionPlan).toBe("free");
    expect(res.subscriptionActiveUntil).toBeNull();
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
    const accWithExpiry = { id: "acc2", is_default: true, plan_type: "team", entitlement: { subscription_plan: null, expires_at: validExpiry } };
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
    const acc = { id: "acc3", is_default: true, plan_type: "team", entitlement: { subscription_plan: null, expires_at: validExpiry } };
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

  it("same valid idToken after 6h falls through to network (no forever refresh)", async () => {
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
    mocks.proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ accounts: [{ id: "a", entitlement: { subscription_plan: "plus", expires_at: future } }] }),
    });
    const res = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: jwt, providerSpecificData: psd, proxyOptions: null, now: baseNow });
    expect(mocks.proxyAwareFetch).toHaveBeenCalled();
    expect(res.subscriptionActiveUntil).toBe(new Date(future).toISOString());
    expect(res.subscriptionSource).toBe("accounts");
  });

  it("uses provider registry via U('codex') not hardcoded endpoint", async () => {
    const { U } = await import("../../open-sse/services/usage/shared.js");
    expect(U("codex").accountsCheckUrl).toBe("https://chatgpt.com/backend-api/accounts/check/v4-2023-04-27");
    expect(U("codex").subscriptionsUrl).toBe("https://chatgpt.com/backend-api/subscriptions");
  });

  // past network-derived expiry handling
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
    const acc = { id: "acc2", is_default: true, plan_type: "team", entitlement: { subscription_plan: null, expires_at: future } };
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

  // review fixes
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

  // Cockpit protocol regressions
  it("accounts/check requires Cockpit web headers Referer User-Agent x-openai-target", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const future = isoNowPlus(10);
    mocks.proxyAwareFetch.mockImplementation(async (url, options) => {
      const headers = options?.headers || {};
      const targetPath = new URL(String(url)).pathname;
      const hasRequiredHeaders =
        getHeader(headers, "Authorization") === "Bearer at" &&
        /application\/json/i.test(String(getHeader(headers, "Accept"))) &&
        getHeader(headers, "Referer") === "https://chatgpt.com/" &&
        /Mozilla/i.test(String(getHeader(headers, "User-Agent"))) &&
        getHeader(headers, "x-openai-target-path") === targetPath &&
        getHeader(headers, "x-openai-target-route") === targetPath;
      if (!hasRequiredHeaders) {
        return { ok: false, status: 403, json: async () => ({ error: "forbidden" }) };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          accounts: [{ id: "acc_paid", organization_id: "org_paid", entitlement: { subscription_plan: "pro", expires_at: future } }],
        }),
      };
    });
    const result = await getCodexSubscriptionEntitlement({
      accessToken: "at",
      idToken: null,
      providerSpecificData: {},
      proxyOptions: null,
      now: Date.now(),
    });
    expect(result.subscriptionActiveUntil).toBe(new Date(future).toISOString());
  });
  it("accessToken hint beats stale idToken and PSD", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const futurePaid = isoNowPlus(20);
    const futureFree = isoNowPlus(1);
    const accessToken = makeJwt({ "https://api.openai.com/auth": { poid: "org_paid", chatgpt_account_id: "acc_paid" } });
    const idToken = makeJwt({ "https://api.openai.com/auth": { organization_id: "org_free", chatgpt_account_id: "acc_free" } });
    const accounts = [
      { id: "acc_free", organization_id: "org_free", entitlement: { subscription_plan: "free", expires_at: futureFree } },
      { id: "acc_paid", organization_id: "org_paid", entitlement: { subscription_plan: "pro", expires_at: futurePaid } },
    ];
    mocks.proxyAwareFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ accounts }) });
    const result = await getCodexSubscriptionEntitlement({
      accessToken,
      idToken,
      providerSpecificData: { organizationId: "org_free", chatgptAccountId: "acc_free" },
      proxyOptions: null,
      now: Date.now(),
    });
    expect(getHeader(mocks.proxyAwareFetch.mock.calls[0][1].headers, "ChatGPT-Account-Id")).toBe("acc_paid");
    expect(result.subscriptionPlan).toBe("pro");
    expect(result.subscriptionActiveUntil).toBe(new Date(futurePaid).toISOString());
  });

  it("nested object map preserves outer org key and account_ordering", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const futureOther = isoNowPlus(2);
    const futureTarget = isoNowPlus(15);
    const accounts = {
      org_other: {
        account: { id: "inner_other", plan_type: "plus" },
        entitlement: { subscription_plan: "plus", expires_at: futureOther },
      },
      org_target: {
        account: { id: "inner_target", plan_type: "pro" },
        entitlement: { subscription_plan: "pro", expires_at: futureTarget },
      },
    };
    const data = { accounts, account_ordering: ["org_target", "org_other"] };
    mocks.proxyAwareFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => data });
    const ordered = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: null, providerSpecificData: {}, proxyOptions: null, now: Date.now() });
    expect(ordered.subscriptionPlan).toBe("pro");
    expect(ordered.subscriptionActiveUntil).toBe(new Date(futureTarget).toISOString());

    mocks.proxyAwareFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => data });
    const hinted = await getCodexSubscriptionEntitlement({
      accessToken: makeJwt({ "https://api.openai.com/auth": { organization_id: "org_other" } }),
      idToken: null,
      providerSpecificData: {},
      proxyOptions: null,
      now: Date.now(),
    });
    expect(hinted.subscriptionPlan).toBe("plus");
    expect(hinted.subscriptionActiveUntil).toBe(new Date(futureOther).toISOString());

    for (const wrapped of [{ data: { accounts } }, { result: { accounts } }]) {
      mocks.proxyAwareFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => wrapped });
      const parsed = await getCodexSubscriptionEntitlement({
        accessToken: makeJwt({ "https://api.openai.com/auth": { organization_id: "org_target" } }),
        idToken: null,
        providerSpecificData: {},
        proxyOptions: null,
        now: Date.now(),
      });
      expect(parsed.subscriptionPlan).toBe("pro");
    }
  });

  it("subscriptions fallback uses web headers encoded id ChatGPT-Account-Id", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const past = isoNowPlus(-5);
    const future = isoNowPlus(10);
    const accountId = "acc 1/special";
    mocks.proxyAwareFetch.mockImplementation(async (url, options) => {
      const isSubscription = String(url).includes("/backend-api/subscriptions");
      if (!isSubscription) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ accounts: [{ id: accountId, entitlement: { subscription_plan: null, expires_at: past } }] }),
        };
      }
      const headers = options.headers || {};
      const targetPath = new URL(String(url)).pathname;
      expect(String(url)).toContain(`account_id=${encodeURIComponent(accountId)}`);
      expect(getHeader(headers, "Authorization")).toBe("Bearer at");
      expect(String(getHeader(headers, "Accept"))).toMatch(/application\/json/i);
      expect(getHeader(headers, "Referer")).toBe("https://chatgpt.com/");
      expect(String(getHeader(headers, "User-Agent"))).toMatch(/Mozilla/i);
      expect(getHeader(headers, "x-openai-target-path")).toBe(targetPath);
      expect(getHeader(headers, "x-openai-target-route")).toBe(targetPath);
      expect(getHeader(headers, "ChatGPT-Account-Id")).toBe(accountId);
      return { ok: true, status: 200, json: async () => ({ subscription_plan: "pro", active_until: future }) };
    });
    const result = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: null, providerSpecificData: {}, proxyOptions: null, now: Date.now() });
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(result.subscriptionActiveUntil).toBe(new Date(future).toISOString());
  });

  it("CRLF in account id is stripped from ChatGPT-Account-Id header", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const future = isoNowPlus(10);
    const injectedAccountId = "acc\r\nInjected: yes";
    const accessToken = makeJwt({ "https://api.openai.com/auth": { chatgpt_account_id: injectedAccountId } });
    let capturedHeader = null;
    mocks.proxyAwareFetch.mockImplementation(async (url, options) => {
      const headers = options?.headers || {};
      capturedHeader = getHeader(headers, "ChatGPT-Account-Id");
      // request must remain functional — return valid account with sanitized id
      return {
        ok: true,
        status: 200,
        json: async () => ({ accounts: [{ id: "acc_clean", organization_id: "org_clean", entitlement: { subscription_plan: "pro", expires_at: future } }] }),
      };
    });
    const result = await getCodexSubscriptionEntitlement({ accessToken, idToken: null, providerSpecificData: {}, proxyOptions: null, now: Date.now() });
    expect(capturedHeader).not.toBeNull();
    expect(String(capturedHeader)).not.toMatch(/[\r\n]/);
    expect(String(capturedHeader)).toBe("accInjected: yes");
    expect(result.subscriptionActiveUntil).toBe(new Date(future).toISOString());
  });

  it("nested object-map with no inner id falls back to outer key for subscriptions", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const past = isoNowPlus(-5);
    const future = isoNowPlus(10);
    const outerKey = "org/fallback id";
    const accounts = {
      [outerKey]: {
        // no id / account_id / chatgpt_account_id / accountId inside
        entitlement: { subscription_plan: null, expires_at: past },
      },
    };
    mocks.proxyAwareFetch.mockImplementation(async (url, options) => {
      const isSubscription = String(url).includes("/backend-api/subscriptions");
      if (!isSubscription) {
        return { ok: true, status: 200, json: async () => ({ accounts }) };
      }
      const headers = options.headers || {};
      const targetPath = new URL(String(url)).pathname;
      expect(String(url)).toContain(`account_id=${encodeURIComponent(outerKey)}`);
      expect(getHeader(headers, "ChatGPT-Account-Id")).toBe(outerKey);
      expect(getHeader(headers, "Authorization")).toBe("Bearer at");
      expect(String(getHeader(headers, "Accept"))).toMatch(/application\/json/i);
      expect(getHeader(headers, "Referer")).toBe("https://chatgpt.com/");
      expect(String(getHeader(headers, "User-Agent"))).toMatch(/Mozilla/i);
      expect(getHeader(headers, "x-openai-target-path")).toBe(targetPath);
      expect(getHeader(headers, "x-openai-target-route")).toBe(targetPath);
      return { ok: true, status: 200, json: async () => ({ subscription_plan: "pro", active_until: future }) };
    });
    const result = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: null, providerSpecificData: {}, proxyOptions: null, now: Date.now() });
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(2);
    expect(result.subscriptionActiveUntil).toBe(new Date(future).toISOString());
    expect(result.subscriptionPlan).toBe("pro");
    expect(result.subscriptionSource).toMatch(/subscriptions/i);
  });

  it("malformed JWT remains fail-open and exposes only safe cache fields", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const future = isoNowPlus(10);
    const token = "sk-secret-token-xyz";
    mocks.proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ accounts: [{ id: "a", entitlement: { subscription_plan: "plus", expires_at: future } }] }),
    });
    const result = await getCodexSubscriptionEntitlement({
      accessToken: token,
      idToken: "not.a.valid.jwt",
      providerSpecificData: {},
      proxyOptions: null,
      now: Date.now(),
    });
    expect(result.subscriptionActiveUntil).toBe(new Date(future).toISOString());
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(token);
    for (const forbidden of ["accountId", "organizationId", "organization_id", "raw", "accessToken", "idToken"]) {
      expect(serialized).not.toContain(forbidden);
    }
    const allowedPatchKeys = new Set(["codexSubscriptionActiveUntil", "codexSubscriptionPlan", "codexSubscriptionSource", "codexSubscriptionFetchedAt", "codexSubscriptionAttemptAt"]);
    for (const key of Object.keys(result.patch || {})) expect(allowedPatchKeys.has(key)).toBe(true);
  });

  it("force=true + future JWT chatgptplusplan + accounts/check Free/no expiry: fetch happens; free/null/accounts", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const future = isoNowPlus(10);
    const jwt = makeJwt({ "https://api.openai.com/auth": { chatgpt_subscription_active_until: future, chatgpt_plan_type: "chatgptplusplan" } });
    mocks.proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ accounts: [{ id: "acc1", is_default: true, entitlement: { subscription_plan: "chatgptfreeplan", expires_at: null } }] }),
    });
    const now = Date.now();
    const res = await getCodexSubscriptionEntitlement({
      accessToken: "at",
      idToken: jwt,
      providerSpecificData: {},
      proxyOptions: null,
      force: true,
      now,
    });
    expect(mocks.proxyAwareFetch).toHaveBeenCalled();
    expect(res.subscriptionPlan).toBe("free");
    expect(res.subscriptionActiveUntil).toBeNull();
    expect(res.subscriptionSource).toBe("accounts");
    expect(res.patch.codexSubscriptionActiveUntil).toBeNull();
    expect(res.patch.codexSubscriptionPlan).toBe("free");
    expect(res.patch.codexSubscriptionSource).toBe("accounts");
    expect(res.patch.codexSubscriptionFetchedAt).toBeTruthy();
    expect(res.patch.codexSubscriptionAttemptAt).toBeTruthy();
  });

  it("same without force but cached JWT fetchedAt older than 6h: network Free wins", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const now = Date.now();
    const future = new Date(now + 10 * 86400000).toISOString();
    const jwt = makeJwt({ "https://api.openai.com/auth": { chatgpt_subscription_active_until: future, chatgpt_plan_type: "chatgptplusplan" } });
    const staleAt = new Date(now - 7 * 60 * 60 * 1000).toISOString();
    const psd = {
      codexSubscriptionActiveUntil: future,
      codexSubscriptionPlan: "plus",
      codexSubscriptionSource: "idToken",
      codexSubscriptionFetchedAt: staleAt,
      codexSubscriptionAttemptAt: staleAt,
    };
    mocks.proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ accounts: [{ id: "acc1", is_default: true, entitlement: { subscription_plan: "chatgptfreeplan", expires_at: null } }] }),
    });
    const res = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: jwt, providerSpecificData: psd, proxyOptions: null, now, force: false });
    expect(mocks.proxyAwareFetch).toHaveBeenCalled();
    expect(res.subscriptionPlan).toBe("free");
    expect(res.subscriptionActiveUntil).toBeNull();
    expect(res.subscriptionSource).toBe("accounts");
  });

  it("fresh non-force JWT raw chatgptplusplan returns canonical plus no fetch", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const now = Date.now();
    const future = isoNowPlus(10);
    const jwt = makeJwt({ "https://api.openai.com/auth": { chatgpt_subscription_active_until: future, chatgpt_plan_type: "chatgptplusplan" } });
    const normalizedFuture = new Date(future).toISOString();
    const freshAt = new Date(now - 60 * 1000).toISOString();
    const res = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: jwt, providerSpecificData: { codexSubscriptionActiveUntil: normalizedFuture, codexSubscriptionPlan: "plus", codexSubscriptionSource: "idToken", codexSubscriptionFetchedAt: freshAt, codexSubscriptionAttemptAt: freshAt }, proxyOptions: null, now, force: false });
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
    expect(res.subscriptionPlan).toBe("plus");
    expect(res.subscriptionActiveUntil).toBe(normalizedFuture);
    expect(res.subscriptionSource).toBe("idToken");
  });

  it("accounts/check Free with past expiry remains Free/null and subscriptions fallback not called", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const past = isoNowPlus(-5);
    mocks.proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ accounts: [{ id: "acc1", is_default: true, entitlement: { subscription_plan: "chatgptfreeplan", expires_at: past } }] }),
    });
    const res = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: null, providerSpecificData: {}, proxyOptions: null, now: Date.now() });
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(res.subscriptionPlan).toBe("free");
    expect(res.subscriptionActiveUntil).toBeNull();
    expect(res.subscriptionSource).toBe("accounts");
    expect(res.patch.codexSubscriptionActiveUntil).toBeNull();
    expect(res.patch.codexSubscriptionPlan).toBe("free");
  });

  it("transient network failure with future paid PSD retains paid snapshot", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const now = Date.now();
    const future = new Date(now + 10 * 86400000).toISOString();
    const staleAt = new Date(now - 7 * 60 * 60 * 1000).toISOString();
    const psd = {
      codexSubscriptionActiveUntil: future,
      codexSubscriptionPlan: "pro",
      codexSubscriptionSource: "accounts",
      codexSubscriptionFetchedAt: staleAt,
      codexSubscriptionAttemptAt: staleAt,
    };
    mocks.proxyAwareFetch.mockRejectedValueOnce(new Error("network down"));
    const res = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: null, providerSpecificData: psd, proxyOptions: null, now });
    expect(res.subscriptionActiveUntil).toBe(future);
    expect(res.subscriptionPlan).toBe("pro");
    expect(res.patch.codexSubscriptionActiveUntil).toBeUndefined();
    expect(res.patch.codexSubscriptionAttemptAt).toBeTruthy();
  });

  it("sequential resurrection: force Free persists and second non-force JWT Plus does not resurrect", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const future = isoNowPlus(10);
    const jwt = makeJwt({ "https://api.openai.com/auth": { chatgpt_subscription_active_until: future, chatgpt_plan_type: "chatgptplusplan" } });
    mocks.proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ accounts: [{ id: "acc1", is_default: true, entitlement: { subscription_plan: "chatgptfreeplan", expires_at: null } }] }),
    });
    const baseNow = Date.now();
    const r1 = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: jwt, providerSpecificData: {}, proxyOptions: null, force: true, now: baseNow });
    expect(r1.subscriptionPlan).toBe("free");
    expect(r1.subscriptionActiveUntil).toBeNull();
    expect(r1.subscriptionSource).toBe("accounts");
    const psd2 = { ...r1.patch };
    mocks.proxyAwareFetch.mockClear();
    const r2 = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: jwt, providerSpecificData: psd2, proxyOptions: null, force: false, now: baseNow + 60 * 1000 });
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
    expect(r2.subscriptionPlan).toBe("free");
    expect(r2.subscriptionActiveUntil).toBeNull();
    expect(r2.subscriptionSource).toBe("accounts");
  });

  it("fresh cached Free null accounts within 6h and no JWT returns Free null without fetch", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const now = Date.now();
    const psd = {
      codexSubscriptionActiveUntil: null,
      codexSubscriptionPlan: "free",
      codexSubscriptionSource: "accounts",
      codexSubscriptionFetchedAt: new Date(now - 60 * 60 * 1000).toISOString(),
      codexSubscriptionAttemptAt: new Date(now - 60 * 60 * 1000).toISOString(),
    };
    const res = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: null, providerSpecificData: psd, proxyOptions: null, now, force: false });
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
    expect(res.subscriptionPlan).toBe("free");
    expect(res.subscriptionActiveUntil).toBeNull();
    expect(res.subscriptionSource).toBe("accounts");
  });

  it("force true network throw with cached Free preserves Free", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const now = Date.now();
    const psd = {
      codexSubscriptionActiveUntil: null,
      codexSubscriptionPlan: "free",
      codexSubscriptionSource: "accounts",
      codexSubscriptionFetchedAt: new Date(now - 7 * 60 * 60 * 1000).toISOString(),
      codexSubscriptionAttemptAt: new Date(now - 7 * 60 * 60 * 1000).toISOString(),
    };
    mocks.proxyAwareFetch.mockRejectedValueOnce(new Error("network down"));
    const res = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: null, providerSpecificData: psd, proxyOptions: null, now, force: true });
    expect(res.subscriptionActiveUntil).toBeNull();
    expect(res.subscriptionPlan).toBe("free");
    expect(res.subscriptionSource).toBe("accounts");
    expect(res.patch.codexSubscriptionActiveUntil).toBeUndefined();
    expect(res.patch.codexSubscriptionAttemptAt).toBeTruthy();
  });

  it("JWT chatgptfreeplan with future active_until non-force returns free with null expiry", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const now = Date.now();
    const future = isoNowPlus(10);
    const jwt = makeJwt({ "https://api.openai.com/auth": { chatgpt_subscription_active_until: future, chatgpt_plan_type: "chatgptfreeplan" } });
    const freshAt = new Date(now - 60 * 1000).toISOString();
    const res = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: jwt, providerSpecificData: { codexSubscriptionActiveUntil: null, codexSubscriptionPlan: "free", codexSubscriptionSource: "idToken", codexSubscriptionFetchedAt: freshAt, codexSubscriptionAttemptAt: freshAt }, proxyOptions: null, now, force: false });
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
    expect(res.subscriptionPlan).toBe("free");
    expect(res.subscriptionActiveUntil).toBeNull();
    expect(Object.keys(res.patch || {}).length).toBe(0);
  });

  it("accounts missing plan then subscriptions returns chatgptfreeplan with future active_until returns free null", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const future = isoNowPlus(10);
    mocks.proxyAwareFetch
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ accounts: [{ id: "acc1", is_default: true, entitlement: null }] }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ subscription_plan: "chatgptfreeplan", active_until: future }) });
    const res = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: null, providerSpecificData: {}, proxyOptions: null, now: Date.now() });
    expect(res.subscriptionPlan).toBe("free");
    expect(res.subscriptionActiveUntil).toBeNull();
    expect(res.subscriptionSource).toMatch(/subscriptions|accounts/i);
    expect(res.patch.codexSubscriptionActiveUntil).toBeNull();
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(2);
  });

  it("future cached PSD plan chatgptplusplan returns canonical plus", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const now = Date.now();
    const future = new Date(now + 10 * 86400000).toISOString();
    const psd = {
      codexSubscriptionActiveUntil: future,
      codexSubscriptionPlan: "chatgptplusplan",
      codexSubscriptionSource: "accounts",
      codexSubscriptionFetchedAt: new Date(now - 60 * 60 * 1000).toISOString(),
      codexSubscriptionAttemptAt: new Date(now - 60 * 60 * 1000).toISOString(),
    };
    const res = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: null, providerSpecificData: psd, proxyOptions: null, now });
    expect(mocks.proxyAwareFetch).not.toHaveBeenCalled();
    expect(res.subscriptionPlan).toBe("plus");
    expect(res.subscriptionActiveUntil).toBe(future);
  });

  it("generic observed family normalization maps chatgpt prefix and lower-cases", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const now = Date.now();
    const future = isoNowPlus(5);
    const normalizedFuture = new Date(future).toISOString();
    const jwtPro = makeJwt({ "https://api.openai.com/auth": { chatgpt_subscription_active_until: future, chatgpt_plan_type: "chatgptproplan" } });
    const freshPro = new Date(now - 60 * 1000).toISOString();
    const r1 = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: jwtPro, providerSpecificData: { codexSubscriptionActiveUntil: normalizedFuture, codexSubscriptionPlan: "pro", codexSubscriptionSource: "idToken", codexSubscriptionFetchedAt: freshPro, codexSubscriptionAttemptAt: freshPro }, proxyOptions: null, now, force: false });
    expect(r1.subscriptionPlan).toBe("pro");
    const jwtUpper = makeJwt({ "https://api.openai.com/auth": { chatgpt_subscription_active_until: future, chatgpt_plan_type: "PLUS" } });
    const freshPlus = new Date(now - 60 * 1000).toISOString();
    const r2 = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: jwtUpper, providerSpecificData: { codexSubscriptionActiveUntil: normalizedFuture, codexSubscriptionPlan: "plus", codexSubscriptionSource: "idToken", codexSubscriptionFetchedAt: freshPlus, codexSubscriptionAttemptAt: freshPlus }, proxyOptions: null, now, force: false });
    expect(r2.subscriptionPlan).toBe("plus");
    const jwtTeam = makeJwt({ "https://api.openai.com/auth": { chatgpt_subscription_active_until: future, chatgpt_plan_type: "ChatGPTTeamPlan" } });
    const freshTeam = new Date(now - 60 * 1000).toISOString();
    const r3 = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: jwtTeam, providerSpecificData: { codexSubscriptionActiveUntil: normalizedFuture, codexSubscriptionPlan: "team", codexSubscriptionSource: "idToken", codexSubscriptionFetchedAt: freshTeam, codexSubscriptionAttemptAt: freshTeam }, proxyOptions: null, now, force: false });
    expect(r3.subscriptionPlan).toBe("team");
    const jwtBiz = makeJwt({ "https://api.openai.com/auth": { chatgpt_subscription_active_until: future, chatgpt_plan_type: "chatgptbusinessplan" } });
    const freshBiz = new Date(now - 60 * 1000).toISOString();
    const r4 = await getCodexSubscriptionEntitlement({ accessToken: "at", idToken: jwtBiz, providerSpecificData: { codexSubscriptionActiveUntil: normalizedFuture, codexSubscriptionPlan: "business", codexSubscriptionSource: "idToken", codexSubscriptionFetchedAt: freshBiz, codexSubscriptionAttemptAt: freshBiz }, proxyOptions: null, now, force: false });
    expect(r4.subscriptionPlan).toBe("business");
  });

  it("first fetch authoritative mismatch: empty PSD, future JWT Plus must still hit accounts/check and return Free/null/accounts", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const future = isoNowPlus(10);
    const jwt = makeJwt({ "https://api.openai.com/auth": { chatgpt_subscription_active_until: future, chatgpt_plan_type: "chatgptplusplan" } });
    mocks.proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ accounts: [{ id: "acc1", is_default: true, entitlement: { subscription_plan: "chatgptfreeplan", expires_at: null } }] }),
    });
    const res = await getCodexSubscriptionEntitlement({
      accessToken: "at",
      idToken: jwt,
      providerSpecificData: {},
      proxyOptions: null,
      force: false,
      now: Date.now(),
    });
    expect(mocks.proxyAwareFetch).toHaveBeenCalledTimes(1);
    expect(res.subscriptionPlan).toBe("free");
    expect(res.subscriptionActiveUntil).toBeNull();
    expect(res.subscriptionSource).toBe("accounts");
    expect(res.patch.codexSubscriptionPlan).toBe("free");
    expect(res.patch.codexSubscriptionActiveUntil).toBeNull();
  });

  it("plan trust-boundary length: accounts/check 10k-char plan capped to <=64 via public helper", async () => {
    const { getCodexSubscriptionEntitlement } = await import("../../open-sse/services/usage/codex.js");
    const future = isoNowPlus(10);
    const longPlan = "a".repeat(10000);
    mocks.proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ accounts: [{ id: "acc1", is_default: true, entitlement: { subscription_plan: longPlan, expires_at: future } }] }),
    });
    const res = await getCodexSubscriptionEntitlement({
      accessToken: "at",
      idToken: null,
      providerSpecificData: {},
      proxyOptions: null,
      now: Date.now(),
    });
    expect(res.subscriptionPlan).toBeTruthy();
    expect(res.subscriptionPlan.length).toBeLessThanOrEqual(64);
    expect(res.subscriptionPlan).not.toBe(longPlan);
    expect(res.patch.codexSubscriptionPlan).toBeTruthy();
    expect(res.patch.codexSubscriptionPlan.length).toBeLessThanOrEqual(64);
    expect(res.patch.codexSubscriptionPlan).not.toBe(longPlan);
    expect(res.subscriptionActiveUntil).toBe(new Date(future).toISOString());
  });
});
