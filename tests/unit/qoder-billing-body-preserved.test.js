// Regression: a billing-block 403 (code 110) must keep its body readable after
// the login-expired check. The check used resp.text() — consuming the only
// body — so chatCore's parseUpstreamError saw "" and the client got a bare
// "HTTP 403" instead of "Billing daily count exceeded".
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
const completionFrame = sseData({
  statusCodeValue: 200,
  body: JSON.stringify({ id: "c1", object: "chat.completion.chunk", choices: [{ index: 0, delta: { content: "pong" }, finish_reason: null }] }),
}) + "data: [DONE]\n\n";

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

describe("QoderExecutor error body preservation", () => {
  it("keeps the billing-block message readable after the login-expired check", async () => {
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
        return new Response(billingFrame, { headers: { "Content-Type": "text/event-stream" } });
      }
      throw new Error(`unexpected url ${u}`);
    });
    const executor = await loadExecutor(fetchMock);

    const result = await executor.execute({ ...request, credentials: creds() });
    expect(result.response.status).toBe(403);
    // The body must STILL be readable — the login-expired probe must not
    // consume it. parseUpstreamError does resp.text() afterwards.
    const body = await result.response.text();
    expect(body).toContain("Billing daily count exceeded");
    expect(body).toContain("110");
    // Exactly one chat attempt: a billing block is not login-expired, so no retry.
    const chatCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes("agent_chat_generation"));
    expect(chatCalls).toHaveLength(1);
  });

  it("still retries on a genuine 105 login-expired and succeeds with the fresh token", async () => {
    let chatAttempts = 0;
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
        chatAttempts += 1;
        if (chatAttempts === 1) {
          return new Response(sseData({ statusCodeValue: 403, body: JSON.stringify({ code: "105", message: "Login expired" }) }), { headers: { "Content-Type": "text/event-stream" } });
        }
        return new Response(completionFrame, { headers: { "Content-Type": "text/event-stream" } });
      }
      throw new Error(`unexpected url ${u}`);
    });
    const executor = await loadExecutor(fetchMock);

    const result = await executor.execute({ ...request, credentials: creds() });
    expect(result.response.ok).toBe(true);
    expect(await result.response.text()).toContain("pong");
    expect(chatAttempts).toBe(2);
  });
});
