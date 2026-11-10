// Billing-block errors (110 "Billing daily count exceeded") must surface an
// actionable message: live plan-credit usage from /api/v2/quota/usage plus the
// daily-reset boundary (next midnight UTC), because upstream's own body carries
// no timestamp. Also: the account cooldown for this error is the max (30 min)
// rather than the generic 2-minute 403 cooldown.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mockUndiciFetch } from "./helpers/mockUndiciFetch.js";

const PAT = "pt-testpat0000000000000000";
const JT = "jt-live00000000000000000000";
const JRT = "jrt-test0000000000000000000";

const sseData = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const billingFrame = sseData({
  statusCodeValue: 403,
  body: JSON.stringify({ code: "110", message: "Billing daily count exceeded" }),
});

const request = {
  model: "kmodel_latest",
  body: { model: "qoder/kmodel_latest", messages: [{ role: "user", content: "ping" }], stream: true },
  stream: true,
  signal: null,
  log: { info: () => {}, warn: () => {}, error: () => {}, line: () => {} },
};

const creds = () => ({
  apiKey: PAT,
  accessToken: "",
  provider: "qoder",
  connectionId: "conn-1",
  providerSpecificData: { userId: "user-1", machineId: "11111111-2222-5333-8444-555555555555" },
});

function mockFetchWithQuota(quotaBody, quotaStatus = 200) {
  return vi.fn(async (url) => {
    const u = String(url);
    if (u.includes("jobToken/exchange")) {
      return new Response(JSON.stringify({ token: JT, refresh_token: JRT, expires_in: 86400000 }), { headers: { "Content-Type": "application/json" } });
    }
    if (u.includes("userinfo")) {
      return new Response(JSON.stringify({ id: "user-1" }), { headers: { "Content-Type": "application/json" } });
    }
    if (u.includes("model/list")) {
      return new Response(JSON.stringify({ chat: [{ key: "kmodel_latest", display_name: "K", source: "system", max_input_tokens: 200000 }] }), { headers: { "Content-Type": "application/json" } });
    }
    if (u.includes("quota/usage")) {
      if (quotaStatus !== 200) return new Response("{}", { status: quotaStatus });
      return new Response(JSON.stringify(quotaBody), { headers: { "Content-Type": "application/json" } });
    }
    if (u.includes("agent_chat_generation")) {
      return new Response(billingFrame, { headers: { "Content-Type": "text/event-stream" } });
    }
    throw new Error(`unexpected url ${u}`);
  });
}

async function loadExecutor(fetchMock) {
  vi.resetModules();
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy"]) {
    vi.stubEnv(key, "");
  }
  const wrapped = mockUndiciFetch((...args) => fetchMock(...args));
  const { QoderExecutor } = await import("../../open-sse/executors/qoder.js");
  return new QoderExecutor();
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("QoderExecutor billing-block message enrichment", () => {
  it("appends live quota usage and the daily-reset estimate to a 110 error", async () => {
    const fetchMock = mockFetchWithQuota({
      userType: "personal_professional_trial",
      userQuota: { total: 300, used: 300, remaining: 0, unit: "credits" },
      addOnQuota: { total: 400, used: 12, remaining: 388, unit: "credits" },
    });
    const executor = await loadExecutor(fetchMock);

    const result = await executor.execute({ ...request, credentials: creds() });
    expect(result.response.status).toBe(403);
    const body = await result.response.text();
    const parsed = JSON.parse(body);

    expect(parsed.error.message).toContain("Billing daily count exceeded");
    expect(parsed.error.message).toContain("300/300 plan credits used");
    expect(parsed.error.message).toContain("plan personal_professional_trial");
    // Credits must be framed as context, not as the cause of a request-count block.
    expect(parsed.error.message).toContain("credits are not the limit here");
    // Reset line is explicitly an estimate.
    expect(parsed.error.message).toMatch(/daily request window resets by ~(\d+h \d+m|\d+m) at the latest \(est\./);
    // The quota call must be authenticated — without a token it 401s and the
    // enrichment silently degrades.
    const quotaCall = fetchMock.mock.calls.find(([u]) => String(u).includes("quota/usage"));
    expect(quotaCall[1].headers.Authorization).toMatch(/^Bearer jt-/);
    // The quota endpoint was consulted exactly once
    const quotaCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("quota/usage"));
    expect(quotaCalls).toHaveLength(1);
  });

  it("keeps the plain upstream message when the quota endpoint fails", async () => {
    const fetchMock = mockFetchWithQuota(null, 500);
    const executor = await loadExecutor(fetchMock);

    const result = await executor.execute({ ...request, credentials: creds() });
    expect(result.response.status).toBe(403);
    const parsed = JSON.parse(await result.response.text());
    expect(parsed.error.message).toContain("Billing daily count exceeded");
    // Reset estimate is still appended — it needs no upstream data
    expect(parsed.error.message).toMatch(/resets by ~/);
    expect(parsed.error.message).not.toContain("plan credits");
  });

  it("caches the quota read so repeated billing blocks do not re-fetch", async () => {
    const fetchMock = mockFetchWithQuota({
      userType: "personal_professional_trial",
      userQuota: { total: 300, used: 300, remaining: 0, unit: "credits" },
    });
    const executor = await loadExecutor(fetchMock);

    await executor.execute({ ...request, credentials: creds() });
    await executor.execute({ ...request, credentials: creds() });

    const quotaCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("quota/usage"));
    expect(quotaCalls).toHaveLength(1);
    // Both attempts still hit inference — only the quota read is cached.
    const chatCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("agent_chat_generation"));
    expect(chatCalls).toHaveLength(2);
  });

  it("does not consult the quota endpoint on non-billing errors", async () => {
    const fetchMock = vi.fn(async (url) => {
      const u = String(url);
      if (u.includes("jobToken/exchange")) {
        return new Response(JSON.stringify({ token: JT, refresh_token: JRT, expires_in: 86400000 }), { headers: { "Content-Type": "application/json" } });
      }
      if (u.includes("userinfo")) {
        return new Response(JSON.stringify({ id: "user-1" }), { headers: { "Content-Type": "application/json" } });
      }
      if (u.includes("model/list")) {
        return new Response(JSON.stringify({ chat: [{ key: "kmodel_latest", display_name: "K", source: "system", max_input_tokens: 200000 }] }), { headers: { "Content-Type": "application/json" } });
      }
      if (u.includes("agent_chat_generation")) {
        return new Response(sseData({ statusCodeValue: 500, body: JSON.stringify({ code: "10500", message: "InternalError" }) }), { headers: { "Content-Type": "text/event-stream" } });
      }
      throw new Error(`unexpected url ${u}`);
    });
    const executor = await loadExecutor(fetchMock);

    await executor.execute({ ...request, credentials: creds() });
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes("quota/usage"))).toBe(false);
  });
});

describe("errorConfig billing cooldown", () => {
  it("holds a qoder billing daily block for the max cooldown, not 2 minutes", async () => {
    vi.resetModules();
    const { ERROR_RULES, MAX_RATE_LIMIT_COOLDOWN_MS } = await import("../../open-sse/config/errorConfig.js");
    const rule = ERROR_RULES.find((r) => r.provider === "qoder" && r.text === "billing daily count exceeded");
    expect(rule).toBeDefined();
    expect(rule.cooldownMs).toBe(MAX_RATE_LIMIT_COOLDOWN_MS);

    // And the generic 403 status rule must NOT win for this text (text rules
    // are checked first, so the specific rule shields it).
    const { checkFallbackError } = await import("../../open-sse/services/accountFallback.js");
    const outcome = checkFallbackError(403, "Billing daily count exceeded", 0, "qoder");
    expect(outcome.cooldownMs).toBe(MAX_RATE_LIMIT_COOLDOWN_MS);
  });
});
