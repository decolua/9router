import { beforeEach, describe, expect, it, vi } from "vitest";

const usageDbMocks = vi.hoisted(() => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
}));

vi.mock("@/lib/usageDb.js", () => usageDbMocks);

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { saveUsageStats } = await import("../../open-sse/handlers/chatCore/requestDetail.js");
const { buildOnStreamComplete } = await import("../../open-sse/handlers/chatCore/streamingHandler.js");
const { handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

function expectSavedReservation(id) {
  expect(usageDbMocks.saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({
    usageReservationId: id,
  }));
}

function baseContext(usageReservationId) {
  return {
    provider: "openai",
    model: "gpt-4o",
    body: { model: "openai/gpt-4o", messages: [] },
    stream: false,
    translatedBody: null,
    finalBody: null,
    requestStartTime: Date.now(),
    connectionId: "connection-test",
    apiKey: "sk-client-test",
    usageReservationId,
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    trackDone: vi.fn(),
    appendLog: vi.fn(),
    reqTag: "request-test",
    log: { line: vi.fn() },
  };
}

beforeEach(() => vi.clearAllMocks());

describe("chat usage reservation plumbing", () => {
  it("passes the internal reservation ID from saveUsageStats to saveRequestUsage", () => {
    saveUsageStats({
      provider: "openai",
      model: "gpt-4o",
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      usageReservationId: "reservation-direct",
    });

    expectSavedReservation("reservation-direct");
  });

  it("passes the reservation ID on streaming completion", () => {
    const { onStreamComplete } = buildOnStreamComplete({
      ...baseContext("reservation-stream"),
      stream: true,
    });

    onStreamComplete(
      { content: "ok" },
      { prompt_tokens: 10, completion_tokens: 5 },
      Date.now(),
    );

    expectSavedReservation("reservation-stream");
  });

  it("passes the reservation ID for a non-streaming JSON response", async () => {
    const context = baseContext("reservation-json");
    const result = await handleNonStreamingResponse({
      ...context,
      providerResponse: new Response(JSON.stringify({
        choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }), { status: 200, headers: { "content-type": "application/json" } }),
      sourceFormat: FORMATS.OPENAI,
      targetFormat: FORMATS.OPENAI,
      reqLogger: {
        logProviderResponse: vi.fn(),
        logConvertedResponse: vi.fn(),
      },
    });

    expect(result.success).toBe(true);
    expectSavedReservation("reservation-json");
  });

  it("passes the reservation ID for standard forced SSE-to-JSON", async () => {
    const context = baseContext("reservation-forced-chat");
    const sse = [
      `data: ${JSON.stringify({
        id: "chatcmpl-test",
        choices: [{ index: 0, delta: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");
    const result = await handleForcedSSEToJson({
      ...context,
      providerResponse: new Response(sse, { headers: { "content-type": "text/event-stream" } }),
      sourceFormat: FORMATS.OPENAI,
    });

    expect(result.success).toBe(true);
    expectSavedReservation("reservation-forced-chat");
  });

  it("passes the reservation ID for Responses forced SSE-to-JSON", async () => {
    const context = {
      ...baseContext("reservation-forced-responses"),
      provider: "codex",
      model: "gpt-5-codex",
    };
    const sse = [
      "event: response.output_item.done",
      `data: ${JSON.stringify({
        output_index: 0,
        item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] },
      })}`,
      "",
      "event: response.completed",
      `data: ${JSON.stringify({
        response: { usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } },
      })}`,
      "",
    ].join("\n");
    const result = await handleForcedSSEToJson({
      ...context,
      providerResponse: new Response(sse, { headers: { "content-type": "text/event-stream" } }),
      sourceFormat: FORMATS.OPENAI_RESPONSES,
    });

    expect(result.success).toBe(true);
    expectSavedReservation("reservation-forced-responses");
  });
});
