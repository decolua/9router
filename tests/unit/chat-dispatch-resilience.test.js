import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  trackPendingRequest: vi.fn(async () => {}),
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  translateResponse: vi.fn((_target, _source, chunk) => [chunk]),
  needsTranslation: vi.fn(() => false),
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
  saveRequestUsage: mocks.saveRequestUsage,
}));
vi.mock("@/lib/pxpipe/loader.js", () => ({ getTransform: vi.fn() }));
vi.mock("@/lib/pxpipe/events.js", () => ({ appendPxpipeEvent: vi.fn(async () => {}) }));
vi.mock("../../open-sse/translator/index.js", () => ({
  translateRequest: vi.fn((_source, _target, _model, body) => ({ ...body })),
  translateResponse: mocks.translateResponse,
  initState: vi.fn(() => ({ usage: null })),
  needsTranslation: mocks.needsTranslation,
  register: vi.fn(),
}));
vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: (provider) => ["openai", "groq", "codex"].includes(provider) ? mocks.fakeExecutor : null,
}));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { createPassthroughStreamWithLogger, createSSETransformStreamWithLogger } = await import("../../open-sse/utils/stream.js");
const { evaluateCircuit, recordCircuitOutcome, resetCircuitBreaker } = await import("../../open-sse/services/circuitBreaker.js");
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
    mocks.saveRequestDetail.mockReset();
    mocks.saveRequestDetail.mockResolvedValue(undefined);
    mocks.saveRequestUsage.mockReset();
    mocks.saveRequestUsage.mockResolvedValue(undefined);
    mocks.translateResponse.mockReset();
    mocks.translateResponse.mockImplementation((_target, _source, chunk) => [chunk]);
    mocks.needsTranslation.mockReset();
    mocks.needsTranslation.mockReturnValue(false);
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

  it("invokes request success once and keeps bookkeeping errors out of the provider result", async () => {
    mocks.fakeExecutor.execute.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ id: "ok", choices: [{ message: { role: "assistant", content: "ok" } }] }), { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://provider.invalid/chat",
      headers: {},
      transformedBody: {},
    });
    const onRequestSuccess = vi.fn(async () => { throw new Error("bookkeeping unavailable"); });
    const events = [];
    const result = await handleChatCore({
      body: { model: "gpt-test", messages: [{ role: "user", content: "hello" }], stream: false },
      modelInfo: { provider: "groq", model: "gpt-test" },
      credentials: { accessToken: "test-token", providerSpecificData: {} },
      log: noiseLog(),
      sourceFormatOverride: "openai",
      connectionId: "success-connection",
      clientRawRequest: { endpoint: "/v1/chat/completions", body: { model: "gpt-test" }, headers: {} },
      onRequestSuccess,
      onResilienceEvent: (event) => events.push(event),
    });

    expect(result.success).toBe(true);
    expect(onRequestSuccess).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["DISPATCH_START", "NON_STREAM_COMPLETED"]);
  });

  it("keeps malformed JSON as a processing failure without invoking account success bookkeeping", async () => {
    mocks.fakeExecutor.execute.mockResolvedValueOnce({
      response: new Response("not-json", { status: 200, headers: { "content-type": "application/json" } }),
      url: "https://provider.invalid/chat",
      headers: {},
      transformedBody: {},
    });
    const onRequestSuccess = vi.fn();
    const events = [];
    const result = await handleChatCore({
      body: { model: "gpt-test", messages: [{ role: "user", content: "hello" }], stream: false },
      modelInfo: { provider: "groq", model: "gpt-test" },
      credentials: { accessToken: "test-token", providerSpecificData: {} },
      log: noiseLog(),
      sourceFormatOverride: "openai",
      connectionId: "malformed-connection",
      clientRawRequest: { endpoint: "/v1/chat/completions", body: { model: "gpt-test" }, headers: {} },
      onRequestSuccess,
      onResilienceEvent: (event, details) => events.push([event, details]),
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(events).toContainEqual(["DISPATCH_FAILED", expect.objectContaining({ origin: "processing" })]);
  });

  it("releases a half-open processing failure without clearing upstream failures", () => {
    const provider = "claude";
    const bucket = "direct:processing-half-open";
    const openedAt = Date.now();
    const cooldownEndsAt = openedAt + 10 + 5 * 60 * 1000;

    for (let i = 0; i < 10; i++) {
      recordCircuitOutcome({ provider, bucket, outcome: "DISPATCH_FAILED", status: 503, origin: "upstream_http", connectionId: `failure-${i}`, now: openedAt + i });
    }
    expect(evaluateCircuit(provider, bucket, openedAt + 10)).toMatchObject({ state: "OPEN", allowed: false });
    expect(evaluateCircuit(provider, bucket, cooldownEndsAt + 1)).toMatchObject({ state: "HALF_OPEN", allowed: true, probe: true });

    recordCircuitOutcome({ provider, bucket, outcome: "DISPATCH_FAILED", status: 502, origin: "processing", now: cooldownEndsAt + 2 });

    expect(getProviderFailureCount(provider, bucket, cooldownEndsAt + 2)).toBe(10);
    expect(evaluateCircuit(provider, bucket, cooldownEndsAt + 2)).toMatchObject({ state: "HALF_OPEN", allowed: true, probe: true });
  });

  it.each([403, 503])("preserves a real upstream %i status and origin without success bookkeeping", async (status) => {
    mocks.fakeExecutor.execute.mockResolvedValueOnce({
      response: new Response(JSON.stringify({ error: { message: `upstream ${status}` } }), { status, headers: { "content-type": "application/json" } }),
      url: "https://provider.invalid/chat", headers: {}, transformedBody: {},
    });
    const onRequestSuccess = vi.fn();
    const events = [];
    const result = await handleChatCore({
      body: { model: "gpt-test", messages: [{ role: "user", content: "hello" }], stream: false },
      modelInfo: { provider: "groq", model: "gpt-test" }, credentials: { accessToken: "test-token", providerSpecificData: {} },
      log: noiseLog(), sourceFormatOverride: "openai", connectionId: `upstream-${status}`,
      clientRawRequest: { endpoint: "/v1/chat/completions", body: { model: "gpt-test" }, headers: {} }, onRequestSuccess,
      onResilienceEvent: (event, details) => events.push([event, details]),
    });
    expect(result).toMatchObject({ success: false, status });
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(events).toContainEqual(["DISPATCH_FAILED", expect.objectContaining({ status, origin: "upstream_http" })]);
  });

  it("keeps a forced SSE structured upstream error distinct from local processing", async () => {
    mocks.fakeExecutor.execute.mockResolvedValueOnce({
      response: new Response('data: {"error":{"message":"forbidden","status":403}}\n\ndata: [DONE]\n\n', { status: 200, headers: { "content-type": "text/event-stream" } }),
      url: "https://provider.invalid/chat", headers: {}, transformedBody: {},
    });
    const onRequestSuccess = vi.fn();
    const events = [];
    const result = await handleChatCore({
      body: { model: "gpt-test", messages: [{ role: "user", content: "hello" }], stream: false },
      modelInfo: { provider: "openai", model: "gpt-test" }, credentials: { accessToken: "test-token", providerSpecificData: {} },
      log: noiseLog(), sourceFormatOverride: "openai", connectionId: "forced-sse-error",
      clientRawRequest: { endpoint: "/v1/chat/completions", body: { model: "gpt-test" }, headers: {} }, onRequestSuccess,
      onResilienceEvent: (event, details) => events.push([event, details]),
    });
    expect(result).toMatchObject({ success: false, status: 403 });
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(events).toContainEqual(["DISPATCH_FAILED", expect.objectContaining({ status: 403, origin: "upstream_http" })]);
  });

  it("keeps a failed Responses terminal from becoming a forced-SSE success", async () => {
    const encoder = new TextEncoder();
    mocks.fakeExecutor.execute.mockResolvedValueOnce({
      response: new Response(new ReadableStream({ start(controller) {
        controller.enqueue(encoder.encode('event: response.failed\ndata: {"response":{"status":"failed","error":{"message":"capacity exhausted","status":503}}}\n\n'));
        controller.close();
      } }), { status: 200, headers: { "content-type": "text/event-stream" } }),
      url: "https://provider.invalid/responses", headers: {}, transformedBody: {},
    });
    const onRequestSuccess = vi.fn();
    const events = [];
    const result = await handleChatCore({
      body: { model: "gpt-test", messages: [{ role: "user", content: "hello" }], stream: false },
      modelInfo: { provider: "codex", model: "gpt-test" }, credentials: { accessToken: "test-token", providerSpecificData: {} },
      log: noiseLog(), sourceFormatOverride: "openai", connectionId: "responses-failed",
      clientRawRequest: { endpoint: "/v1/chat/completions", body: { model: "gpt-test" }, headers: {} }, onRequestSuccess,
      onResilienceEvent: (event, details) => events.push([event, details]),
    });
    expect(result).toMatchObject({ success: false, status: 503 });
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(events).toContainEqual(["DISPATCH_FAILED", expect.objectContaining({ status: 503, origin: "upstream_http" })]);
  });

  it.each([
    ["sync", () => { throw new Error("sync bookkeeping failed"); }],
    ["async", async () => { throw new Error("async bookkeeping failed"); }],
  ])("keeps a valid forced-SSE response valid when %s success bookkeeping fails", async (_kind, onRequestSuccess) => {
    mocks.fakeExecutor.execute.mockResolvedValueOnce({
      response: new Response('data: {"id":"ok","choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { status: 200, headers: { "content-type": "text/event-stream" } }),
      url: "https://provider.invalid/chat", headers: {}, transformedBody: {},
    });
    const events = [];
    const result = await handleChatCore({
      body: { model: "gpt-test", messages: [{ role: "user", content: "hello" }], stream: false },
      modelInfo: { provider: "openai", model: "gpt-test" }, credentials: { accessToken: "test-token", providerSpecificData: {} },
      log: noiseLog(), sourceFormatOverride: "openai", connectionId: `forced-success-${_kind}`,
      clientRawRequest: { endpoint: "/v1/chat/completions", body: { model: "gpt-test" }, headers: {} }, onRequestSuccess,
      onResilienceEvent: (event) => events.push(event),
    });
    expect(result.success).toBe(true);
    expect(result.response.status).toBe(200);
    expect(events).toEqual(["DISPATCH_START", "NON_STREAM_COMPLETED"]);
  });

  it.each([403, 503])("treats ordinary non-forced SSE %i as an upstream failure before success accounting", async (status) => {
    mocks.fakeExecutor.execute.mockResolvedValueOnce({
      response: new Response(`data: {"error":{"message":"upstream ${status}","status":${status}}}\n\ndata: [DONE]\n\n`, { status: 200, headers: { "content-type": "text/event-stream" } }),
      url: "https://provider.invalid/chat", headers: {}, transformedBody: {},
    });
    const onRequestSuccess = vi.fn();
    const events = [];
    const result = await handleChatCore({
      body: { model: "gpt-test", messages: [{ role: "user", content: "hello" }], stream: false },
      modelInfo: { provider: "groq", model: "gpt-test" }, credentials: { accessToken: "test-token", providerSpecificData: {} },
      log: noiseLog(), sourceFormatOverride: "openai", connectionId: `ordinary-sse-${status}`,
      clientRawRequest: { endpoint: "/v1/chat/completions", body: { model: "gpt-test" }, headers: {} }, onRequestSuccess,
      onResilienceEvent: (event, details) => events.push([event, details]),
    });
    expect(result).toMatchObject({ success: false, status });
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(events).toContainEqual(["DISPATCH_FAILED", expect.objectContaining({ status, origin: "upstream_http" })]);
  });

  it("keeps live response.failed streaming terminal from invoking success bookkeeping", async () => {
    const encoder = new TextEncoder();
    mocks.fakeExecutor.execute.mockResolvedValueOnce({
      response: new Response(new ReadableStream({ start(controller) {
        controller.enqueue(encoder.encode('event: response.failed\ndata: {"response":{"status":"failed","error":{"message":"capacity exhausted","status":503}}}\n\n'));
        controller.close();
      } }), { status: 200, headers: { "content-type": "text/event-stream" } }),
      url: "https://provider.invalid/responses", headers: {}, transformedBody: {}, responseFormat: "openai-responses",
    });
    const onRequestSuccess = vi.fn();
    const events = [];
    const result = await handleChatCore({
      body: { model: "gpt-test", messages: [{ role: "user", content: "hello" }], stream: true },
      modelInfo: { provider: "codex", model: "gpt-test" }, credentials: { accessToken: "test-token", providerSpecificData: {} },
      log: noiseLog(), sourceFormatOverride: "openai-responses", connectionId: "live-responses-failed",
      clientRawRequest: { endpoint: "/v1/responses", body: { model: "gpt-test" }, headers: {} }, onRequestSuccess,
      onResilienceEvent: (event, details) => events.push([event, details]),
    });
    await result.response.text();
    await Promise.resolve();
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(events).toContainEqual(["STREAM_FAILED", expect.objectContaining({ status: 503, origin: "upstream_http" })]);
    expect(events).not.toContainEqual(["STREAM_COMPLETED", expect.anything()]);
  });

  it("lets a late Responses failure before EOF override provisional completion", async () => {
    const encoder = new TextEncoder();
    mocks.fakeExecutor.execute.mockResolvedValueOnce({
      response: new Response(new ReadableStream({ start(controller) {
        controller.enqueue(encoder.encode('event: response.completed\ndata: {"response":{"status":"completed"}}\n\nevent: response.failed\ndata: {"response":{"status":"failed","usage":{"input_tokens":11,"output_tokens":7},"error":{"message":"late failure","status":503}}}\n\n'));
        controller.close();
      } }), { status: 200, headers: { "content-type": "text/event-stream" } }),
      url: "https://provider.invalid/responses", headers: {}, transformedBody: {}, responseFormat: "openai-responses",
    });
    const onRequestSuccess = vi.fn();
    const events = [];
    const result = await handleChatCore({
      body: { model: "gpt-test", messages: [{ role: "user", content: "hello" }], stream: true },
      modelInfo: { provider: "codex", model: "gpt-test" }, credentials: { accessToken: "test-token", providerSpecificData: {} },
      log: noiseLog(), sourceFormatOverride: "openai-responses", connectionId: "completed-then-failed",
      clientRawRequest: { endpoint: "/v1/responses", body: { model: "gpt-test" }, headers: {} }, onRequestSuccess,
      onResilienceEvent: (event, details) => events.push([event, details]),
    });
    await result.response.text();
    await Promise.resolve();
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(events.filter(([event]) => event === "STREAM_FAILED")).toHaveLength(1);
    expect(events.filter(([event]) => event === "STREAM_COMPLETED")).toHaveLength(0);
    expect(mocks.saveRequestDetail.mock.calls.map(([detail]) => detail).filter(detail => detail?.status === "error")).toHaveLength(1);
    expect(mocks.saveRequestUsage).toHaveBeenCalledTimes(1);
  });

  it("records authoritative stream usage once as failed for live response.failed", async () => {
    const encoder = new TextEncoder();
    mocks.fakeExecutor.execute.mockResolvedValueOnce({
      response: new Response(new ReadableStream({ start(controller) {
        controller.enqueue(encoder.encode('event: response.in_progress\ndata: {"response":{"usage":{"input_tokens":11,"output_tokens":7,"total_tokens":18,"input_tokens_details":{"cached_tokens":5},"output_tokens_details":{"reasoning_tokens":3}}}}\n\nevent: response.failed\ndata: {"response":{"status":"failed","error":{"message":"capacity exhausted","status":503}}}\n\n'));
        controller.close();
      } }), { status: 200, headers: { "content-type": "text/event-stream" } }),
      url: "https://provider.invalid/responses", headers: {}, transformedBody: {}, responseFormat: "openai-responses",
    });
    const result = await handleChatCore({
      body: { model: "gpt-test", messages: [{ role: "user", content: "hello" }], stream: true },
      modelInfo: { provider: "codex", model: "gpt-test" }, credentials: { accessToken: "test-token", providerSpecificData: {} },
      log: noiseLog(), sourceFormatOverride: "openai-responses", connectionId: "failed-usage-once",
      clientRawRequest: { endpoint: "/v1/responses", body: { model: "gpt-test" }, headers: {} },
    });
    await result.response.text();
    await Promise.resolve();
    const failureDetails = mocks.saveRequestDetail.mock.calls.map(([detail]) => detail).filter((detail) => detail?.status === "error");
    expect(failureDetails).toHaveLength(1);
    expect(failureDetails[0].tokens).toMatchObject({ prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, cached_tokens: 5, reasoning_tokens: 3 });
    expect(mocks.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(mocks.saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({
      status: "error",
      tokens: expect.objectContaining({ prompt_tokens: 11, completion_tokens: 7, total_tokens: 18, cached_tokens: 5, reasoning_tokens: 3 }),
    }));
  });

  it("keeps a successful passthrough Responses completed terminal with exactly one DONE", async () => {
    const failure = vi.fn();
    const success = vi.fn();
    const stream = createPassthroughStreamWithLogger("codex", null, "gpt-test", "completed-main", {}, success, failure, null, "openai-responses", "openai-responses");
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const output = (async () => {
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) return text;
        text += new TextDecoder().decode(value);
      }
    })();
    await writer.write(new TextEncoder().encode('event: response.completed\ndata: {"response":{"status":"completed"}}\n\ndata: [DONE]\n\n'));
    await writer.close();
    const outputText = await output;
    expect(failure).not.toHaveBeenCalled();
    expect(success).toHaveBeenCalledOnce();
    expect((outputText.match(/data: \[DONE\]/g) || [])).toHaveLength(1);
    expect(outputText).not.toContain("event: response.failed");
  });

  it("keeps a no-newline completed Responses tail successful", async () => {
    const failure = vi.fn();
    const success = vi.fn();
    const stream = createPassthroughStreamWithLogger("codex", null, "gpt-test", "completed-tail", {}, success, failure, null, "openai-responses", "openai-responses");
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const output = (async () => { while (!(await reader.read()).done) {} })();
    await writer.write(new TextEncoder().encode('event: response.completed\ndata: {"response":{"status":"completed"}}'));
    await writer.close();
    await output;
    expect(failure).not.toHaveBeenCalled();
    expect(success).toHaveBeenCalledOnce();
  });

  it("emits passthrough Responses failure before DONE at EOF without a terminal", async () => {
    const failure = vi.fn();
    const success = vi.fn();
    const stream = createPassthroughStreamWithLogger("codex", null, "gpt-test", "passthrough-eof", {}, success, failure, null, "openai-responses", "openai-responses");
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const output = (async () => {
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) return text;
        text += new TextDecoder().decode(value);
      }
    })();
    await writer.write(new TextEncoder().encode('event: response.output_item.added\ndata: {"item":{"type":"message"}}\n\n'));
    await writer.close();
    const outputText = await output;
    expect(failure).toHaveBeenCalledOnce();
    expect(success).not.toHaveBeenCalled();
    expect(outputText.indexOf("event: response.failed")).toBeGreaterThanOrEqual(0);
    expect(outputText.indexOf("event: response.failed")).toBeLessThan(outputText.indexOf("data: [DONE]"));
  });

  it("synthesizes a missing passthrough Responses terminal before an upstream DONE", async () => {
    const failure = vi.fn();
    const success = vi.fn();
    const stream = createPassthroughStreamWithLogger("codex", null, "gpt-test", "inprogress-done", {}, success, failure, null, "openai-responses", "openai-responses");
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const output = (async () => {
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) return text;
        text += new TextDecoder().decode(value);
      }
    })();
    await writer.write(new TextEncoder().encode('event: response.in_progress\ndata: {"response":{"status":"in_progress"}}\n\ndata: [DONE]\n\n'));
    await writer.close();
    const outputText = await output;
    expect(failure).toHaveBeenCalledOnce();
    expect(success).not.toHaveBeenCalled();
    expect((outputText.match(/event: response.failed/g) || [])).toHaveLength(1);
    expect((outputText.match(/data: \[DONE\]/g) || [])).toHaveLength(1);
    expect(outputText.indexOf("event: response.failed")).toBeLessThan(outputText.indexOf("data: [DONE]"));
  });

  it("keeps a failed passthrough Responses terminal before one existing DONE", async () => {
    const failure = vi.fn();
    const success = vi.fn();
    const stream = createPassthroughStreamWithLogger("codex", null, "gpt-test", "failed-main", {}, success, failure, null, "openai-responses", "openai-responses");
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const output = (async () => {
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) return text;
        text += new TextDecoder().decode(value);
      }
    })();
    await writer.write(new TextEncoder().encode('event: response.failed\ndata: {"response":{"status":"failed","error":{"message":"failed","status":503}}}\n\ndata: [DONE]\n\n'));
    await writer.close();
    const outputText = await output;
    expect(failure).toHaveBeenCalledOnce();
    expect(success).not.toHaveBeenCalled();
    expect((outputText.match(/data: \[DONE\]/g) || [])).toHaveLength(1);
    expect(outputText.indexOf("event: response.failed")).toBeLessThan(outputText.indexOf("data: [DONE]"));
  });

  it("classifies a no-newline response.failed tail with authoritative usage", async () => {
    const failure = vi.fn();
    const success = vi.fn();
    const stream = createPassthroughStreamWithLogger("codex", null, "gpt-test", "tail-failed", {}, success, failure, null, "openai-responses", "openai-responses");
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const output = (async () => {
      while (!(await reader.read()).done) {}
    })();
    await writer.write(new TextEncoder().encode('event: response.failed\ndata: {"response":{"status":"failed","usage":{"input_tokens":11,"output_tokens":7,"input_tokens_details":{"cached_tokens":5},"output_tokens_details":{"reasoning_tokens":3}},"error":{"message":"tail failed","status":503}}}'));
    await writer.close();
    await output;
    expect(failure).toHaveBeenCalledOnce();
    expect(failure).toHaveBeenCalledWith(expect.objectContaining({
      status: 503,
      usage: expect.objectContaining({ prompt_tokens: 11, completion_tokens: 7, cached_tokens: 5, reasoning_tokens: 3 }),
    }));
    expect(success).not.toHaveBeenCalled();
  });

  it("reports a mid-stream translator exception as processing failure without success", async () => {
    mocks.needsTranslation.mockReturnValueOnce(true);
    mocks.translateResponse.mockImplementationOnce(() => { throw new Error("translator chunk failed"); });
    const encoder = new TextEncoder();
    mocks.fakeExecutor.execute.mockResolvedValueOnce({
      response: new Response(new ReadableStream({ start(controller) {
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"x"}}]}\n\n'));
        controller.close();
      } }), { status: 200, headers: { "content-type": "text/event-stream" } }),
      url: "https://provider.invalid/chat", headers: {}, transformedBody: {},
    });
    const onRequestSuccess = vi.fn();
    const events = [];
    const result = await handleChatCore({
      body: { model: "gpt-test", messages: [{ role: "user", content: "hello" }], stream: true },
      modelInfo: { provider: "groq", model: "gpt-test" }, credentials: { accessToken: "test-token", providerSpecificData: {} },
      log: noiseLog(), sourceFormatOverride: "openai", connectionId: "translator-chunk-failure",
      clientRawRequest: { endpoint: "/v1/chat/completions", body: { model: "gpt-test" }, headers: {} }, onRequestSuccess,
      onResilienceEvent: (event, details) => events.push([event, details]),
    });
    await result.response.text();
    await Promise.resolve();
    expect(mocks.translateResponse).toHaveBeenCalledTimes(1);
    expect(mocks.translateResponse).toHaveBeenCalledWith("openai", "openai", expect.any(Object), expect.any(Object));
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(events).toEqual(expect.arrayContaining([["STREAM_FAILED", expect.objectContaining({ status: 502, origin: "processing" })]]));
    expect(events.filter(([event]) => event === "STREAM_FAILED")).toHaveLength(1);
    expect(events.filter(([event]) => event === "STREAM_COMPLETED")).toHaveLength(0);
  });

  it("treats translator flush exceptions as processing failures", async () => {
    mocks.translateResponse.mockImplementationOnce(() => { throw new Error("translator flush failed"); });
    const failure = vi.fn();
    const success = vi.fn();
    const stream = createSSETransformStreamWithLogger("openai", "claude", "test", null, null, "gpt-test", "flush-failed", {}, success, failure);
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();
    const output = (async () => {
      while (!(await reader.read()).done) {}
    })();
    await writer.close();
    await output;
    expect(failure).toHaveBeenCalledWith(expect.objectContaining({ origin: "processing", message: "translator flush failed" }));
    expect(success).not.toHaveBeenCalled();
  });

  it("treats missing Responses terminal at EOF as failure rather than success", async () => {
    const encoder = new TextEncoder();
    mocks.fakeExecutor.execute.mockResolvedValueOnce({
      response: new Response(new ReadableStream({ start(controller) {
        controller.enqueue(encoder.encode('event: response.output_item.added\ndata: {"item":{"type":"message"}}\n\n'));
        controller.close();
      } }), { status: 200, headers: { "content-type": "text/event-stream" } }),
      url: "https://provider.invalid/responses", headers: {}, transformedBody: {}, responseFormat: "openai-responses",
    });
    const onRequestSuccess = vi.fn();
    const events = [];
    const result = await handleChatCore({
      body: { model: "gpt-test", messages: [{ role: "user", content: "hello" }], stream: true },
      modelInfo: { provider: "codex", model: "gpt-test" }, credentials: { accessToken: "test-token", providerSpecificData: {} },
      log: noiseLog(), sourceFormatOverride: "openai-responses", connectionId: "missing-terminal-eof",
      clientRawRequest: { endpoint: "/v1/responses", body: { model: "gpt-test" }, headers: {} }, onRequestSuccess,
      onResilienceEvent: (event, details) => events.push([event, details]),
    });
    await result.response.text();
    await Promise.resolve();
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(events).toContainEqual(["STREAM_FAILED", expect.objectContaining({ origin: "processing" })]);
    expect(events).not.toContainEqual(["STREAM_COMPLETED", expect.anything()]);
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
