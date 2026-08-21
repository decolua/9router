import { describe, it, expect, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  trackPendingRequest: vi.fn(async () => {}),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  fakeExecutor: {
    execute: vi.fn(async () => ({ response: new Response("ok"), url: "https://test.local", headers: {}, transformedBody: {} })),
    parseError: vi.fn(),
    noAuth: false,
  },
}));

vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: mocks.trackPendingRequest,
  appendRequestLog: mocks.appendRequestLog,
  saveRequestDetail: mocks.saveRequestDetail,
  saveRequestUsage: vi.fn(async () => {}),
}));

vi.mock("@/lib/pxpipe/loader.js", () => ({ getTransform: vi.fn() }));
vi.mock("@/lib/pxpipe/events.js", () => ({ appendPxpipeEvent: vi.fn(async () => {}) }));

// getExecutor is called with `provider` as the first argument — a bare string,
// not a symbol. Keep the fake factory string-keyed like the real map.
vi.mock("../../open-sse/executors/index.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getExecutor: (provider) =>
      provider === "freebuff" ? mocks.fakeExecutor : actual.getExecutor(provider),
  };
});

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const FAKE_MODEL = "deepseek/deepseek-v4-flash";

function noiseLog() {
  return { debug() {}, info() {}, warn() {}, line() {}, errorLine() {} };
}

async function runOnce({ error }) {
  mocks.fakeExecutor.execute.mockRejectedValueOnce(error);
  return handleChatCore({
    body: { model: FAKE_MODEL, messages: [{ role: "user", content: "hello" }] },
    modelInfo: { provider: "freebuff", model: FAKE_MODEL },
    credentials: { accessToken: "tok", providerSpecificData: { proxyPoolId: "pool-a", vercelRelayUrl: "https://relay.test" } },
    log: noiseLog(),
    sourceFormatOverride: "openai",
    connectionId: "conn-test",
    clientRawRequest: { endpoint: "/v1/chat/completions", body: { model: FAKE_MODEL }, headers: {} },
  });
}

describe("handleChatCore executor error propagation", () => {
  it("preserves a structured 409 model-lock error with resetsAtMs and pool scoping instead of flattening to 502", async () => {
    const resetsAtMs = Date.now() + 10_000;
    const lockError = Object.assign(new Error("Freebuff session locked to another model"), {
      status: 409,
      resetsAtMs,
      poolScoped: { poolId: "pool-a", reason: "limited_ip" },
    });

    const result = await runOnce({ error: lockError });

    expect(result.success).toBe(false);
    expect(result.status).toBe(409);
    expect(result.resetsAtMs).toBe(resetsAtMs);
    expect(result.poolScoped).toEqual({ poolId: "pool-a", reason: "limited_ip" });
    expect(result.response.status).toBe(409);
    expect(result.error).toContain("409");
    expect(result.error).toContain("Freebuff session locked");
  });

  it("still returns 502 for a generic transport error that has no bounded status", async () => {
    const networkError = Object.assign(new Error("fetch failed"), { cause: { code: "ECONNRESET" } });

    const result = await runOnce({ error: networkError });

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.response.status).toBe(502);
    expect(result.error).toContain("ECONNRESET");
    expect(result.error).toContain("502");
  });

  it("falls back to 502 when the thrown status is outside the valid HTTP error range", async () => {
    const bogus = Object.assign(new Error("boom"), { status: 200, resetsAtMs: Date.now() });

    const result = await runOnce({ error: bogus });

    expect(result.status).toBe(502);
    expect(result.response.status).toBe(502);
  });

  it("marks aborted executions as 499 and keeps abort behavior unchanged", async () => {
    mocks.trackPendingRequest.mockClear();
    const abortError = Object.assign(new Error("Aborted"), { name: "AbortError" });

    const result = await runOnce({ error: abortError });

    expect(result.success).toBe(false);
    expect(result.status).toBe(499);
    expect(result.response.status).toBe(499);
    expect(result.error).toBe("Request aborted");
    expect(mocks.appendRequestLog).toHaveBeenCalledWith(
      expect.objectContaining({ status: "FAILED 499" })
    );
  });
});