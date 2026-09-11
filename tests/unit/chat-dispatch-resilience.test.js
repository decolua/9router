import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  trackPendingRequest: vi.fn(async () => {}),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  fakeExecutor: {
    execute: vi.fn(),
    parseError: vi.fn(),
    noAuth: true,
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
vi.mock("../../open-sse/translator/index.js", () => ({
  translateRequest: vi.fn((_source, _target, _model, body) => ({ ...body })),
  needsTranslation: vi.fn(() => false),
  register: vi.fn(),
}));
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: (provider) => provider === "openai" ? mocks.fakeExecutor : null,
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { recordCircuitOutcome, resetCircuitBreaker } = await import("../../open-sse/services/circuitBreaker.js");
const { getProviderFailureCount, resetProviderFailureTracker } = await import("../../open-sse/services/providerFailureTracker.js");
const { acquireAccountSlot, getAccountSemaphoreSnapshot, resetAccountSemaphores } = await import("../../open-sse/services/accountSemaphore.js");

function noiseLog() {
  return { debug() {}, info() {}, warn() {}, line() {}, errorLine() {} };
}

describe("chatCore non-ok dispatch resilience wiring", () => {
  beforeEach(() => {
    resetCircuitBreaker();
    resetProviderFailureTracker();
    mocks.fakeExecutor.execute.mockReset();
    mocks.fakeExecutor.parseError.mockReset();
  });

  it("emits DISPATCH_FAILED for a real upstream 503 and records it in the tracker", async () => {
    mocks.fakeExecutor.execute.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ error: { message: "upstream unavailable" } }), { status: 503 }),
      url: "https://provider.invalid/chat",
      headers: {},
      transformedBody: {},
    });

    const events = [];
    const provider = "openai";
    const bucket = "direct:integration-test";
    const result = await handleChatCore({
      body: { model: "gpt-test", messages: [{ role: "user", content: "hello" }], stream: false },
      modelInfo: { provider, model: "gpt-test" },
      credentials: { accessToken: "test-token", providerSpecificData: {} },
      log: noiseLog(),
      sourceFormatOverride: "openai",
      connectionId: "integration-connection",
      clientRawRequest: { endpoint: "/v1/chat/completions", body: { model: "gpt-test" }, headers: {} },
      onResilienceEvent: (event, details) => {
        events.push([event, details]);
        if (event === "DISPATCH_FAILED") recordCircuitOutcome({ provider, bucket, ...details });
      },
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(503);
    expect(events).toContainEqual([
      "DISPATCH_FAILED",
      expect.objectContaining({ provider, model: "gpt-test", connectionId: "integration-connection", status: 503, origin: "upstream_http" }),
    ]);
    expect(getProviderFailureCount(provider, bucket)).toBe(1);
  });

  it("keeps a streaming semaphore slot until a later terminal event", async () => {
    const provider = "openai";
    const bucket = "direct:streaming-test";
    const releaseSlot = await acquireAccountSlot({ provider, connectionId: "stream-connection", bucket, maxConcurrency: 1 });
    const events = [];
    mocks.fakeExecutor.execute.mockResolvedValueOnce({
      response: new Response("data: {\\\"id\\\":\\\"test\\\"}\\n\\n", { status: 200, headers: { "content-type": "text/event-stream" } }),
      url: "https://provider.invalid/chat",
      headers: {},
      transformedBody: {},
    });

    const emitResilienceEvent = (event, details) => {
      events.push([event, details]);
      if (event === "STREAM_COMPLETED") releaseSlot();
    };
    const result = await handleChatCore({
      body: { model: "gpt-test", messages: [{ role: "user", content: "hello" }], stream: true },
      modelInfo: { provider, model: "gpt-test" },
      credentials: { accessToken: "test-token", providerSpecificData: {} },
      log: noiseLog(),
      sourceFormatOverride: "openai",
      connectionId: "stream-connection",
      clientRawRequest: { endpoint: "/v1/chat/completions", body: { model: "gpt-test" }, headers: {} },
      onResilienceEvent: emitResilienceEvent,
    });

    expect(result.success).toBe(true);
    expect(getAccountSemaphoreSnapshot()).toEqual([
      expect.objectContaining({ active: 1, queued: 0 }),
    ]);
    emitResilienceEvent("STREAM_COMPLETED", { provider, model: "gpt-test", connectionId: "stream-connection" });
    await Promise.resolve();
    expect(getAccountSemaphoreSnapshot()).toEqual([]);
  });
});
