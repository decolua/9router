import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { saveRequestDetail, saveRequestUsage } from "@/lib/usageDb.js";

beforeEach(() => vi.clearAllMocks());

const sse = (chunks) => chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n";

function context(raw, sourceFormat = FORMATS.CLAUDE, contentType = "text/event-stream") {
  return {
    providerResponse: new Response(raw, { headers: { "content-type": contentType } }),
    provider: "kiro", model: "test-model", sourceFormat, targetFormat: FORMATS.OPENAI,
    body: { model: "test-model", stream: false, messages: [] }, stream: false,
    requestStartTime: Date.now(), connectionId: "test-connection",
    clientRawRequest: { endpoint: sourceFormat === FORMATS.CLAUDE ? "/v1/messages" : "/v1/chat/completions" },
    onRequestSuccess: vi.fn(), trackDone: vi.fn(), appendLog: vi.fn(),
    reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
    log: { line: vi.fn() },
  };
}

function forcedContext(raw) {
  return {
    ...context(raw, FORMATS.OPENAI),
    sourceFormat: FORMATS.OPENAI,
    targetFormat: FORMATS.OPENAI,
    provider: "op-test-chat",
  };
}

function expectFailed(ctx, result, status) {
  expect(result.success).toBe(false);
  expect(result.status).toBe(status);
  expect(result.response.status).toBe(status);
  expect(ctx.trackDone).toHaveBeenCalledOnce();
  expect(ctx.appendLog).toHaveBeenCalledExactlyOnceWith({ status: `FAILED ${status}` });
  expect(ctx.onRequestSuccess).not.toHaveBeenCalled();
  expect(ctx.reqLogger.logConvertedResponse).not.toHaveBeenCalled();
  expect(ctx.log.line).not.toHaveBeenCalled();
  expect(saveRequestDetail).not.toHaveBeenCalled();
  expect(saveRequestUsage).not.toHaveBeenCalled();
}

describe("non-streaming SSE errors", () => {
  it.each([
    [undefined, 502], [403, 403], ["429", 429], [503, 503],
    [399, 502], [600, 502], [503.5, 502], ["invalid", 502],
  ])("maps upstream status %s to HTTP %s without success side effects", async (upstreamStatus, status) => {
    const ctx = context(sse([{ error: { status: upstreamStatus, message: "Upstream failed" } }]));

    const result = await handleNonStreamingResponse(ctx);

    expectFailed(ctx, result, status);
    expect(await result.response.json()).toMatchObject({ error: { message: "Upstream failed" } });
  });

  it.each([FORMATS.OPENAI, FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES])("returns an error for a %s client", async (sourceFormat) => {
    const ctx = context(sse([{ error: { message: "Kiro integrity gate failed", code: "kiro_missing_terminal" } }]), sourceFormat);
    const result = await handleNonStreamingResponse(ctx);

    expectFailed(ctx, result, 502);
    const json = await result.response.json();
    expect(json.error.message).toBe("Kiro integrity gate failed");
    expect(json).not.toHaveProperty("choices");
    expect(json).not.toHaveProperty("output");
  });

  it("prefers a terminal error over partial content and reported usage", async () => {
    const ctx = context(sse([
      { choices: [{ delta: { content: "partial answer" } }], usage: { prompt_tokens: 12, completion_tokens: 3 } },
      { error: { message: "Stream interrupted", code: "kiro_missing_terminal" } },
    ]));
    const result = await handleNonStreamingResponse(ctx);

    expectFailed(ctx, result, 502);
    expect(await result.response.json()).toMatchObject({ error: { message: "Stream interrupted" } });
  });

  it("uses the existing stream-error fallback when no message is supplied", async () => {
    const ctx = context(sse([{ error: { status: 503 } }]));
    const result = await handleNonStreamingResponse(ctx);

    expectFailed(ctx, result, 503);
    expect((await result.response.json()).error.message).toBe("Upstream SSE stream failed");
  });

  const statusErrors = [
    ["HTTP 524", { error: { status: 524, message: "Upstream timed out" } }, 502, 524],
    ["HTTP 403", { error: { status: 403, message: "Account forbidden" } }, 403, 403],
    ["HTTP 429", { error: { status: 429, message: "Rate limited" } }, 429, 429],
    ["numeric code 429", { message: "Rate limited", code: 429 }, 429, 429],
    ["numeric code 503", { message: "Service unavailable", code: 503 }, 503, 503],
  ];

  it.each(statusErrors)("maps %s in both SSE-to-JSON handlers", async (_label, error, status, accountStatus) => {
    const raw = sse([error]);
    const nonStreaming = context(raw);
    const forced = forcedContext(raw);

    const results = await Promise.all([
      handleNonStreamingResponse(nonStreaming),
      handleForcedSSEToJson(forced),
    ]);

    for (const [ctx, result] of [[nonStreaming, results[0]], [forced, results[1]]]) {
      expect(result.success).toBe(false);
      expect(result.status).toBe(status);
      expect(result.accountStatus).toBe(accountStatus);
      expect(result.response.status).toBe(status);
      expect(ctx.onRequestSuccess).not.toHaveBeenCalled();
      expect(ctx.log.line).not.toHaveBeenCalled();
    }
    expect(nonStreaming.appendLog).toHaveBeenCalledExactlyOnceWith({ status: `FAILED ${status}` });
    expect(forced.appendLog).not.toHaveBeenCalledWith(expect.objectContaining({ status: "200 OK" }));
    expect(saveRequestDetail).not.toHaveBeenCalled();
    expect(saveRequestUsage).not.toHaveBeenCalled();
  });

  it.each([
    ["flat error", { type: "upstream_error", message: "Flat relay failure", code: 503 }, "Flat relay failure", 503],
    ["double-encoded message", { message: JSON.stringify({ message: "Double-encoded failure", code: 429 }) }, "Double-encoded failure", 429],
    ["Responses failure", { type: "response.failed", response: { error: { message: "Responses request failed" } } }, "Responses request failed", 502],
  ])("rejects %s in both handlers without success side effects", async (_label, error, message, status) => {
    const raw = sse([error]);
    const nonStreaming = context(raw);
    const forced = forcedContext(raw);

    const results = await Promise.all([
      handleNonStreamingResponse(nonStreaming),
      handleForcedSSEToJson(forced),
    ]);

    for (const [ctx, result] of [[nonStreaming, results[0]], [forced, results[1]]]) {
      expect(result.success).toBe(false);
      expect(result.status).toBe(status);
      expect(result.response.status).toBe(status);
      expect((await result.response.json()).error.message).toBe(message);
      expect(ctx.onRequestSuccess).not.toHaveBeenCalled();
      expect(ctx.log.line).not.toHaveBeenCalled();
    }
    expect(nonStreaming.appendLog).toHaveBeenCalledExactlyOnceWith({ status: `FAILED ${status}` });
    expect(forced.appendLog).not.toHaveBeenCalledWith(expect.objectContaining({ status: "200 OK" }));
    expect(saveRequestDetail).not.toHaveBeenCalled();
    expect(saveRequestUsage).not.toHaveBeenCalled();
  });

  it("rejects a Responses API failure before success callbacks and usage tracking", async () => {
    const raw = [
      'event: response.failed\ndata: {"type":"response.failed","response":{"error":{"status":524,"message":"Responses upstream timed out"}}}',
      "",
    ].join("\n");
    const ctx = {
      ...forcedContext(raw),
      provider: "codex",
      targetFormat: FORMATS.OPENAI_RESPONSES,
    };

    const result = await handleForcedSSEToJson(ctx);

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.accountStatus).toBe(524);
    expect(result.response.status).toBe(502);
    expect((await result.response.json()).error.message).toBe("Responses upstream timed out");
    expect(ctx.onRequestSuccess).not.toHaveBeenCalled();
    expect(ctx.appendLog).not.toHaveBeenCalledWith(expect.objectContaining({ status: "200 OK" }));
    expect(ctx.log.line).not.toHaveBeenCalled();
    expect(saveRequestDetail).not.toHaveBeenCalled();
    expect(saveRequestUsage).not.toHaveBeenCalled();
  });

  it.each([FORMATS.OPENAI, FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES])("preserves successful SSE conversion for a %s client", async (sourceFormat) => {
    const ctx = context(sse([
      { id: "chatcmpl-test", choices: [{ delta: { content: "hello" }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } },
    ]), sourceFormat);
    const result = await handleNonStreamingResponse(ctx);
    const json = await result.response.json();

    expect(result.success).toBe(true);
    expect(result.response.status).toBe(200);
    if (sourceFormat === FORMATS.CLAUDE) expect(json.content[0].text).toBe("hello");
    else if (sourceFormat === FORMATS.OPENAI_RESPONSES) expect(json.output[0].content[0].text).toBe("hello");
    else expect(json.choices[0].message.content).toBe("hello");
    expect(ctx.onRequestSuccess).toHaveBeenCalledOnce();
    expect(ctx.appendLog).toHaveBeenCalledWith(expect.objectContaining({ status: "200 OK" }));
    expect(saveRequestDetail).toHaveBeenCalledOnce();
    expect(saveRequestUsage).toHaveBeenCalledOnce();
  });

  it("retains the existing error for an unparseable SSE body", async () => {
    const ctx = context("data: [DONE]\n\n");
    const result = await handleNonStreamingResponse(ctx);

    expectFailed(ctx, result, 502);
    expect((await result.response.json()).error.message).toBe("Invalid SSE response for non-streaming request");
  });
});
