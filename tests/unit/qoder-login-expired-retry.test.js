// Executor-level recovery for "Login expired" (403/code 105): when upstream
// rejects the cached job token, execute() must invalidate the cache, re-exchange
// the PAT, and retry once — not surface a transient-looking 403 that cools the
// account for 2 minutes and fails identically on every client retry.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { mockUndiciFetch } from "./helpers/mockUndiciFetch.js";

const PAT = "pt-testpat0000000000000000";
const JT_DEAD = "jt-dead00000000000000000000";
const JT_LIVE = "jt-live00000000000000000000";
const JRT = "jrt-test0000000000000000000";

const sseData = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const completionFrame = sseData({
  statusCodeValue: 200,
  body: JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "pong" }, finish_reason: null }] }),
}) + "data: [DONE]\n\n";
const loginExpiredFrame = sseData({
  statusCodeValue: 403,
  body: JSON.stringify({ code: "105", message: "Login expired" }),
});

const request = {
  model: "dfmodel",
  body: { model: "qoder/dfmodel", messages: [{ role: "user", content: "ping" }], stream: true },
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

// Chat calls are counted by URL; the first chat attempt is answered with the
// login-expired envelope, later ones with a completion.
function makeFetch({ firstToken = JT_DEAD, liveToken = JT_LIVE, alwaysReject = false }) {
  const calls = [];
  let chatAttempts = 0;
  const mock = vi.fn(async (url, options = {}) => {
    const u = String(url);
    calls.push({ url: u, method: options.method || "GET" });
    if (u.includes("jobToken/exchange")) {
      // First exchange serves the (soon-dead) token; post-invalidation
      // exchanges serve the live one.
      return new Response(
        JSON.stringify({ token: mock.exchanges === 0 ? firstToken : liveToken, refresh_token: JRT, expires_in: 86400000 }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    if (u.includes("jobToken/refresh")) {
      return new Response(
        JSON.stringify({ token: liveToken, refresh_token: JRT, expires_in: 86400000 }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    if (u.includes("userinfo")) {
      return new Response(JSON.stringify({ id: "user-1" }), { headers: { "Content-Type": "application/json" } });
    }
    if (u.includes("model/list")) {
      return new Response(
        JSON.stringify({ chat: [{ key: "dfmodel", display_name: "DF", source: "system", max_input_tokens: 200000 }] }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    if (u.includes("agent_chat_generation")) {
      chatAttempts += 1;
      if (alwaysReject || chatAttempts === 1) {
        return new Response(loginExpiredFrame, { headers: { "Content-Type": "text/event-stream" } });
      }
      return new Response(completionFrame, { headers: { "Content-Type": "text/event-stream" } });
    }
    throw new Error(`unexpected url ${u}`);
  });
  mock.calls = calls;
  mock.exchanges = 0;
  const origImpl = mock.getMockImplementation();
  mock.mockImplementation(async (url, options = {}) => {
    if (String(url).includes("jobToken/exchange")) mock.exchanges += 1;
    return origImpl(url, options);
  });
  mock.chatAttempts = () => chatAttempts;
  return mock;
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

describe("QoderExecutor login-expired recovery", () => {
  it("re-exchanges the PAT and retries once when upstream answers 105 Login expired", async () => {
    const fetchMock = makeFetch({});
    const executor = await loadExecutor(fetchMock);

    const result = await executor.execute({ ...request, credentials: creds() });
    expect(result.response.ok).toBe(true);
    const text = await result.response.text();
    expect(text).toContain("pong");

    // The inference host rejected the first (dead) token, then served the retry.
    const chatCalls = fetchMock.calls.filter((c) => c.url.includes("agent_chat_generation"));
    expect(chatCalls).toHaveLength(2);
    // And a re-acquisition (rotation via jrt-, or full PAT exchange) happened
    // after the rejection.
    const rotations = fetchMock.calls.filter((c) => c.url.includes("jobToken/refresh")).length;
    expect(fetchMock.exchanges + rotations).toBeGreaterThanOrEqual(2);
  });

  it("surfaces the 403 when the PAT itself cannot produce a live token", async () => {
    const fetchMock = makeFetch({ alwaysReject: true });
    const executor = await loadExecutor(fetchMock);

    const result = await executor.execute({ ...request, credentials: creds() });
    expect(result.response.status).toBe(403);
    const body = await result.response.text();
    expect(body).toContain("Login expired");
    // Exactly two inference attempts: initial + the single retry.
    const chatCalls = fetchMock.calls.filter((c) => c.url.includes("agent_chat_generation"));
    expect(chatCalls).toHaveLength(2);
  });

  it("does not retry when the first attempt succeeds", async () => {
    // No dead token: the very first chat call answers a completion.
    const calls = [];
    const fetchMock = vi.fn(async (url) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("jobToken/exchange")) {
        return new Response(JSON.stringify({ token: JT_LIVE, refresh_token: JRT, expires_in: 86400000 }), { headers: { "Content-Type": "application/json" } });
      }
      if (u.includes("userinfo")) {
        return new Response(JSON.stringify({ id: "user-1" }), { headers: { "Content-Type": "application/json" } });
      }
      if (u.includes("model/list")) {
        return new Response(JSON.stringify({ chat: [{ key: "dfmodel", display_name: "DF", source: "system", max_input_tokens: 200000 }] }), { headers: { "Content-Type": "application/json" } });
      }
      if (u.includes("agent_chat_generation")) {
        return new Response(completionFrame, { headers: { "Content-Type": "text/event-stream" } });
      }
      throw new Error(`unexpected url ${u}`);
    });
    const executor = await loadExecutor(fetchMock);

    const result = await executor.execute({ ...request, credentials: creds() });
    expect(result.response.ok).toBe(true);
    expect(calls.filter((u) => u.includes("agent_chat_generation"))).toHaveLength(1);
  });
});
