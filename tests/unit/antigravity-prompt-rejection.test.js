// A bare RESOURCE_EXHAUSTED from Antigravity (generic message, no details) is a refusal of the
// request body, not a quota signal: it repeats for the same body every time, while real quota
// errors carry reset info. It must not be retried, refresh quota, or lock the account's model.
import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: (...args) => fetchMock(...args),
}));

const { AntigravityExecutor, isAntigravityPromptRejection, ANTIGRAVITY_PROMPT_REJECTED_MESSAGE } = await import("../../open-sse/executors/antigravity.js");
const { parseUpstreamError } = await import("../../open-sse/utils/error.js");
const { checkFallbackError } = await import("../../open-sse/services/accountFallback.js");

// Exact upstream body from the failing request log.
const BARE = JSON.stringify({ error: { code: 429, message: "Resource has been exhausted (e.g. check quota).", status: "RESOURCE_EXHAUSTED" } });
const WITH_RETRY_INFO = JSON.stringify({ error: { code: 429, message: "Resource has been exhausted (e.g. check quota).", status: "RESOURCE_EXHAUSTED",
  details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "3s" }] } });
const REAL_QUOTA = JSON.stringify({ error: { code: 429, message: "Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 1h56m48s.", status: "RESOURCE_EXHAUSTED",
  details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "QUOTA_EXHAUSTED", metadata: { quotaResetTimeStamp: new Date(Date.now() + 3600_000).toISOString() } }] } });

const response = (status, body) => new Response(body, { status, headers: { "content-type": "application/json" } });

// proxyAwareFetch's DNS-bypass path (the default for Antigravity's Google hosts) returns this shape:
// no clone(), and text() drains the socket, so a second read gets nothing.
const bypassResponse = (status, body) => {
  let drained = false;
  const res = {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    headers: new Map([["content-type", "application/json"]]),
    text: async () => { if (drained) return ""; drained = true; return body; },
  };
  res.json = async () => JSON.parse(await res.text());
  return res;
};

beforeEach(() => fetchMock.mockReset());

describe("isAntigravityPromptRejection", () => {
  it("matches the bare RESOURCE_EXHAUSTED body", () => {
    expect(isAntigravityPromptRejection(429, BARE)).toBe(true);
  });

  it.each([
    ["one with RetryInfo details", 429, WITH_RETRY_INFO],
    ["a real quota error", 429, REAL_QUOTA],
    ["a non-429 status", 503, BARE],
    ["an empty body", 429, ""],
    ["a non-JSON body", 429, "Resource has been exhausted (e.g. check quota)."],
  ])("does not match %s", (_label, status, body) => {
    expect(isAntigravityPromptRejection(status, body)).toBe(false);
  });
});

describe("Antigravity executor handling", () => {
  const ag = new AntigravityExecutor();

  it("does not retry the bare rejection", async () => {
    expect(await ag.computeRetryDelay(response(429, BARE), 1)).toBe(false);
  });

  it("still backs off on other 429s", async () => {
    expect(await ag.computeRetryDelay(response(429, ""), 1)).toBe(2000);
  });

  it("reports it as a request-scoped 400 with an explanation", async () => {
    const parsed = await parseUpstreamError(response(429, BARE), ag);
    expect(parsed).toMatchObject({ statusCode: 400, message: ANTIGRAVITY_PROMPT_REJECTED_MESSAGE });
    // No text rule (quota/rate/capacity wording) may turn this back into an account lock.
    expect(checkFallbackError(parsed.statusCode, parsed.message, 0, "antigravity"))
      .toEqual({ shouldFallback: false, cooldownMs: 0, requestScoped: true });
  });

  it("keeps real quota errors account-scoped with their reset time", async () => {
    const parsed = await parseUpstreamError(response(429, REAL_QUOTA), ag);
    expect(parsed.statusCode).toBe(429);
    expect(parsed.resetsAtMs).toBeGreaterThan(Date.now());
  });

  it("makes exactly one upstream call for a rejected request", async () => {
    fetchMock.mockImplementation(async () => response(429, BARE));
    const { response: upstream } = await ag.execute({
      model: "gemini-4-hydrogen",
      body: { model: "gemini-4-hydrogen-high", request: { contents: [{ role: "user", parts: [{ text: "hi" }] }], generationConfig: {} } },
      stream: true,
      credentials: { accessToken: "t", projectId: "p", connectionId: "c" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await parseUpstreamError(upstream, ag)).statusCode).toBe(400);
  });

  it("does not retry the bare rejection on the DNS-bypass response shape", async () => {
    fetchMock.mockImplementation(async () => bypassResponse(429, BARE));
    const { response: upstream } = await ag.execute({
      model: "gemini-4-hydrogen",
      body: { model: "gemini-4-hydrogen-high", request: { contents: [{ role: "user", parts: [{ text: "hi" }] }], generationConfig: {} } },
      stream: true,
      credentials: { accessToken: "t", projectId: "p", connectionId: "c" },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The retry hook already read the body; the error parser must still see it.
    expect(await parseUpstreamError(upstream, ag)).toMatchObject({ statusCode: 400, message: ANTIGRAVITY_PROMPT_REJECTED_MESSAGE });
  });
});
