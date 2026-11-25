import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
  saveRequestUsage: vi.fn(() => Promise.resolve()),
}));

vi.mock("@/lib/usageDb.js", () => db);

import { FORMATS } from "../../open-sse/translator/formats.js";
import { handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { handleForcedSSEToJson } from "../../open-sse/handlers/chatCore/sseToJsonHandler.js";

function context(payload, onRequestSuccess = vi.fn()) {
  return {
    providerResponse: new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
    provider: "openai",
    model: "test-model",
    sourceFormat: FORMATS.OPENAI,
    targetFormat: FORMATS.OPENAI,
    body: { model: "test-model", messages: [{ role: "user", content: "hi" }] },
    stream: false,
    requestStartTime: Date.now(),
    connectionId: "conn",
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    onRequestSuccess,
    reqLogger: {
      logProviderResponse: vi.fn(),
      logConvertedResponse: vi.fn(),
    },
    trackDone: vi.fn(),
    appendLog: vi.fn(),
  };
}

describe("non-stream semantic outcome", () => {
  it("rejects an HTTP 200 error envelope before success and usage persistence", async () => {
    const onRequestSuccess = vi.fn();
    const ctx = context({ error: { message: "quota exceeded" } }, onRequestSuccess);

    const result = await handleNonStreamingResponse(ctx);

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.errorKind).toBe("upstream_payload_error");
    expect(onRequestSuccess).not.toHaveBeenCalled();
    expect(ctx.appendLog).toHaveBeenCalledWith({ status: "FAILED 502" });
    expect(db.saveRequestDetail).not.toHaveBeenCalled();
  });

  it("accepts one-character output and notifies success once", async () => {
    const onRequestSuccess = vi.fn();
    const ctx = context({
      id: "chatcmpl-1",
      choices: [{ message: { role: "assistant", content: "x" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }, onRequestSuccess);

    const result = await handleNonStreamingResponse(ctx);
    await Promise.resolve();

    expect(result.success).toBe(true);
    expect(onRequestSuccess).toHaveBeenCalledTimes(1);
  });
});

describe("forced Responses SSE→JSON outcome", () => {
  const event = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  const forced = (raw, onRequestSuccess = vi.fn()) => handleForcedSSEToJson({
    providerResponse: new Response(raw, { headers: { "content-type": "text/event-stream" } }),
    provider: "codex",
    model: "test-model",
    sourceFormat: FORMATS.OPENAI,
    targetFormat: FORMATS.OPENAI_RESPONSES,
    body: { model: "test-model", stream: false, messages: [] },
    stream: false,
    requestStartTime: Date.now(),
    connectionId: "conn",
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    onRequestSuccess,
    trackDone: vi.fn(),
    appendLog: vi.fn(),
  });

  it("rejects a response.failed stream without notifying success", async () => {
    const onRequestSuccess = vi.fn();
    const result = await forced(
      event("response.created", { response: { id: "resp_1" } })
        + event("response.failed", { response: { status: "failed", error: { message: "quota exceeded" } } }),
      onRequestSuccess
    );

    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toContain("quota exceeded");
    expect(onRequestSuccess).not.toHaveBeenCalled();
  });

  it("rejects a stream that ends before any terminal event", async () => {
    const result = await forced(event("response.created", { response: { id: "resp_1" } }));

    expect(result.success).toBe(false);
    expect(result.errorKind).toBe("upstream_incomplete");
  });
});
