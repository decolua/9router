import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleStreamingResponse } = await import("../../open-sse/handlers/chatCore/streamingHandler.js");
const { handleComboChat } = await import("../../open-sse/services/combo.js");

const encoder = new TextEncoder();

function responseFromText(text) {
  return new Response(new ReadableStream({
    start(controller) {
      if (text) controller.enqueue(encoder.encode(text));
      controller.close();
    },
  }), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function streamController() {
  let connected = true;
  return {
    signal: new AbortController().signal,
    startTime: Date.now(),
    isConnected: () => connected,
    handleComplete: vi.fn(() => { connected = false; }),
    handleDisconnect: vi.fn(() => { connected = false; }),
    handleError: vi.fn(() => { connected = false; }),
    abort: vi.fn(() => { connected = false; }),
  };
}

async function run(providerResponse) {
  return handleStreamingResponse({
    providerResponse,
    provider: "anthropic",
    model: "claude-test",
    sourceFormat: FORMATS.CLAUDE,
    targetFormat: FORMATS.CLAUDE,
    body: { messages: [{ role: "user", content: "hi" }] },
    stream: true,
    requestStartTime: Date.now(),
    connectionId: "connection-test",
    streamController: streamController(),
    streamDetailId: "detail-test",
    onStreamComplete: vi.fn(),
  });
}

const log = {
  info: vi.fn(),
  warn: vi.fn(),
};

describe("combo streaming preflight fallback", () => {
  it("fails an empty HTTP 200 before stream commit", async () => {
    const result = await run(responseFromText(""));
    expect(result).toEqual(expect.objectContaining({
      success: false,
      status: 502,
      streamStarted: false,
      comboFallback: true,
    }));
    expect(result.response.status).toBe(502);
  });

  it("tries model two after model one empty-200 preflight failure", async () => {
    const attempts = [];
    const valid = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_second"}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join("\n");

    const response = await handleComboChat({
      body: { messages: [{ role: "user", content: "hi" }] },
      models: ["anthropic/first", "anthropic/second"],
      handleSingleModel: async (_body, model) => {
        attempts.push(model);
        const result = model.endsWith("/first")
          ? await run(responseFromText(""))
          : await run(responseFromText(valid));
        return result.response;
      },
      log,
    });

    expect(attempts).toEqual(["anthropic/first", "anthropic/second"]);
    expect(response.status).toBe(200);
    const output = await response.text();
    expect(output).toContain("msg_second");
    expect(output).not.toContain("stream closed before message_stop");
    expect(output).not.toContain("first");
  });
});
