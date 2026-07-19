import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { handleForcedSSEToJson } = await import("../../open-sse/handlers/chatCore/sseToJsonHandler.js");

function event(type, data = {}) {
  return { type, ...data };
}

function streamFromEvents(events) {
  const encoder = new TextEncoder();
  const payload = events.map(data => [
    `event: ${data.type}`,
    `data: ${JSON.stringify(data)}`,
    ""
  ].join("\n")).join("\n") + "data: [DONE]\n\n";
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    }
  });
}

async function forceJson(sourceFormat, events) {
  const result = await handleForcedSSEToJson({
    providerResponse: new Response(streamFromEvents(events), {
      headers: { "content-type": "text/event-stream" }
    }),
    sourceFormat,
    provider: "codex",
    model: "gpt-5.3-codex",
    body: { model: "gpt-5.3-codex", messages: [] },
    stream: false,
    requestStartTime: Date.now(),
    connectionId: "test-connection",
    clientRawRequest: { endpoint: "/v1/chat/completions" },
    trackDone: vi.fn(),
    appendLog: vi.fn()
  });
  return { result, json: await result.response.json() };
}

function partialEvents(terminal) {
  return [
    event("response.created", {
      response: { id: "resp_forced", model: "gpt-5.3-codex", status: "in_progress", output: [] }
    }),
    event("response.output_text.delta", {
      output_index: 0, item_id: "msg_partial", delta: "partial"
    }),
    event("response.output_item.added", {
      output_index: 1,
      item: { id: "fc_partial", type: "function_call", call_id: "call_partial", name: "lookup", arguments: "" }
    }),
    event("response.function_call_arguments.delta", {
      output_index: 1, item_id: "fc_partial", call_id: "call_partial", delta: "{}"
    }),
    terminal
  ];
}

describe("forced Responses SSE to JSON terminal handling", () => {
  it("retains failed partial output and diagnostics with protocol-valid finishes", async () => {
    const events = partialEvents(event("response.failed", {
      response: {
        id: "resp_forced",
        status: "failed",
        output: [],
        error: { type: "server_error", code: "upstream_failed", message: "upstream failed" },
        usage: { input_tokens: 8, output_tokens: 3, total_tokens: 11 }
      }
    }));

    const chat = (await forceJson(FORMATS.OPENAI, events)).json;
    expect(chat.choices[0]).toMatchObject({
      finish_reason: "stop",
      message: {
        content: "partial[Error] upstream failed",
        tool_calls: [{
          id: "call_partial",
          function: { name: "lookup", arguments: "{}" }
        }]
      }
    });
    expect(chat.usage).toEqual({ prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 });

    const gemini = (await forceJson(FORMATS.GEMINI, events)).json.response;
    expect(gemini.candidates[0].content.parts[0].text).toBe("partial[Error] upstream failed");
    expect(gemini.candidates[0]).not.toHaveProperty("finishReason");
    expect(gemini.usageMetadata).toEqual({
      promptTokenCount: 8,
      candidatesTokenCount: 3,
      totalTokenCount: 11
    });
  });

  it("maps incomplete max-output diagnostics without discarding partial output", async () => {
    const events = partialEvents(event("response.incomplete", {
      response: {
        id: "resp_forced",
        status: "incomplete",
        output: [],
        incomplete_details: { reason: "max_output_tokens" },
        usage: { input_tokens: 5, output_tokens: 4, total_tokens: 9 }
      }
    }));

    const chat = (await forceJson(FORMATS.OPENAI, events)).json;
    expect(chat.choices[0].finish_reason).toBe("length");
    expect(chat.choices[0].message.content).toBe("partial");
    expect(chat.choices[0].message.tool_calls[0]).toMatchObject({
      id: "call_partial",
      function: { name: "lookup", arguments: "{}" }
    });
    expect(chat.usage).toEqual({ prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 });

    const gemini = (await forceJson(FORMATS.ANTIGRAVITY, events)).json.response;
    expect(gemini.candidates[0]).toMatchObject({
      finishReason: "MAX_TOKENS",
      content: { parts: [{ text: "partial" }] }
    });
    expect(gemini.usageMetadata.totalTokenCount).toBe(9);
  });
});
