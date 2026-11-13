import { describe, it, expect, vi } from "vitest";

// Mock undici and other runtime deps
vi.mock("undici", () => ({
  Agent: class MockAgent {},
  ProxyAgent: class MockProxyAgent {},
}));

vi.mock("uuid", () => ({
  v4: () => "mock-uuid-v4-0000",
}));

vi.mock("node-machine-id", () => ({
  machineIdSync: () => "mock-machine-id",
}));

vi.mock("ajv/dist/2020.js", () => ({
  default: class MockAjv {
    compile() {
      return () => true;
    }
  },
}));

vi.mock("@/lib/db/helpers/kvStore.js", () => ({
  makeKv: () => ({
    get: async () => null,
    set: async () => {},
    remove: async () => {},
    getAll: async () => ({}),
  }),
}));

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(),
}));

import "../translator/registerAll.js";

import { FORMATS } from "../../open-sse/translator/formats.js";
import { translateNonStreamingResponse, handleNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";
import { createSSEStream } from "../../open-sse/utils/stream.js";

describe("Claude Messages Compatibility & Non-Streaming Translation", () => {

  const sampleAntigravityJson = {
    response: {
      responseId: "resp_antigravity_compact_99",
      modelVersion: "gemini-3.8-flash",
      candidates: [{
        content: {
          role: "model",
          parts: [{ text: "Summary: The user and assistant investigated 9Router protocol translation." }]
        },
        finishReason: "STOP"
      }],
      usageMetadata: {
        promptTokenCount: 270250,
        candidatesTokenCount: 4862,
        totalTokenCount: 275112
      }
    }
  };

  // 1. Antigravity text response becomes a Claude Message object
  it("translates Antigravity non-streaming response to Anthropic Message object for Claude format", () => {
    const result = translateNonStreamingResponse(sampleAntigravityJson, FORMATS.ANTIGRAVITY, FORMATS.CLAUDE);

    expect(result.type).toBe("message");
    expect(result.role).toBe("assistant");
    expect(result.model).toBe("gemini-3.8-flash");
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0]).toEqual({
      type: "text",
      text: "Summary: The user and assistant investigated 9Router protocol translation."
    });

    expect(result.id).toMatch(/^msg_/);
    expect(result.stop_reason).toBe("end_turn");
    expect(result.stop_sequence).toBeNull();
    expect(result.usage).toEqual({
      input_tokens: 270250,
      output_tokens: 4862
    });

    expect(result.object).toBeUndefined();
    expect(result.choices).toBeUndefined();
  });

  // 2. Antigravity response with tool calls becomes Claude tool_use blocks
  it("translates Antigravity tool calls into Claude tool_use content blocks", () => {
    const toolCallAntigravityJson = {
      response: {
        responseId: "resp_tool_call_01",
        modelVersion: "gemini-3.8-flash",
        candidates: [{
          content: {
            role: "model",
            parts: [{
              functionCall: {
                name: "Read",
                args: { file_path: "package.json" }
              }
            }]
          },
          finishReason: "STOP"
        }],
        usageMetadata: {
          promptTokenCount: 1000,
          candidatesTokenCount: 50,
          totalTokenCount: 1050
        }
      }
    };

    const result = translateNonStreamingResponse(toolCallAntigravityJson, FORMATS.ANTIGRAVITY, FORMATS.CLAUDE);

    expect(result.type).toBe("message");
    expect(result.stop_reason).toBe("tool_use");
    expect(result.content).toEqual([
      {
        type: "tool_use",
        id: expect.stringMatching(/^(call_|toolu_)/),
        name: "Read",
        input: { file_path: "package.json" }
      }
    ]);
  });

  // 3. Other source formats retain their previous output format
  it("preserves OpenAI Chat Completion format when sourceFormat is OPENAI", () => {
    const result = translateNonStreamingResponse(sampleAntigravityJson, FORMATS.ANTIGRAVITY, FORMATS.OPENAI);

    expect(result.object).toBe("chat.completion");
    expect(Array.isArray(result.choices)).toBe(true);
    expect(result.choices[0].message.content).toContain("Summary:");
    expect(result.type).toBeUndefined();
  });

  // 4. Responses format client receives Responses API output
  it("converts to Responses API object when sourceFormat is OPENAI_RESPONSES", () => {
    const result = translateNonStreamingResponse(sampleAntigravityJson, FORMATS.ANTIGRAVITY, FORMATS.OPENAI_RESPONSES);

    expect(result.object).toBe("response");
    expect(Array.isArray(result.output)).toBe(true);
    expect(result.output[0].type).toBe("message");
    expect(result.output[0].content[0].type).toBe("output_text");
  });

  // 5. handleNonStreamingResponse delivers HTTP 200 with request-id and Claude Message
  it("delivers valid Anthropic JSON response and request-id header via handleNonStreamingResponse", async () => {
    const mockProviderResponse = new Response(JSON.stringify(sampleAntigravityJson), {
      status: 200,
      headers: { "content-type": "application/json" }
    });

    const context = {
      providerResponse: mockProviderResponse,
      provider: "antigravity",
      model: "gemini-3.8-flash-high",
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.ANTIGRAVITY,
      body: { model: "ag/gemini-3.8-flash-high", stream: false },
      stream: false,
      requestStartTime: Date.now(),
      connectionId: "conn-test",
      clientRawRequest: { endpoint: "/v1/messages" },
      reqLogger: {
        logProviderResponse: vi.fn(),
        logConvertedResponse: vi.fn(),
      },
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    };

    const handlerResult = await handleNonStreamingResponse(context);
    expect(handlerResult.success).toBe(true);

    const httpResponse = handlerResult.response;
    expect(httpResponse.status).toBe(200);
    expect(httpResponse.headers.get("content-type")).toContain("application/json");

    const reqId = httpResponse.headers.get("request-id");
    expect(reqId).toMatch(/^req_/);

    const bodyJson = await httpResponse.json();
    expect(bodyJson.type).toBe("message");
    expect(bodyJson.role).toBe("assistant");
    expect(bodyJson.content[0].text).toContain("Summary:");
    expect(bodyJson.id).toMatch(/^msg_/);
    expect(bodyJson.id).not.toBe(reqId);
    expect(bodyJson.usage.input_tokens).toBe(270250 + 2000); // 2000 token context buffer
    expect(bodyJson.usage.output_tokens).toBe(4862);
  });

  // 6. Preserves incoming client request-id header and prevents upstream overwrite
  it("preserves incoming client request-id header and prevents upstream headers from overwriting it", async () => {
    const mockProviderResponse = new Response(JSON.stringify(sampleAntigravityJson), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "request-id": "upstream_leaked_id_do_not_use"
      }
    });

    const context = {
      providerResponse: mockProviderResponse,
      provider: "antigravity",
      model: "gemini-3.8-flash-high",
      sourceFormat: FORMATS.CLAUDE,
      targetFormat: FORMATS.ANTIGRAVITY,
      body: { model: "ag/gemini-3.8-flash-high", stream: false },
      stream: false,
      requestStartTime: Date.now(),
      connectionId: "conn-test",
      clientRawRequest: {
        endpoint: "/v1/messages",
        headers: { "x-request-id": "req_client_supplied_unique_123" }
      },
      reqLogger: { logProviderResponse: vi.fn(), logConvertedResponse: vi.fn() },
      trackDone: vi.fn(),
      appendLog: vi.fn(),
    };

    const handlerResult = await handleNonStreamingResponse(context);
    const httpResponse = handlerResult.response;

    expect(httpResponse.headers.get("request-id")).toBe("req_client_supplied_unique_123");
  });

  // 7. Cached token accounting
  describe("Exact Usage Mapping", () => {
    it("maps usage with cachedContentTokenCount correctly (subtracting cached from input_tokens)", () => {
      const cachedAntigravityJson = {
        response: {
          responseId: "resp_cache_test",
          modelVersion: "gemini-3.8-flash",
          candidates: [{ content: { role: "model", parts: [{ text: "cached answer" }] }, finishReason: "STOP" }],
          usageMetadata: {
            promptTokenCount: 10000,
            cachedContentTokenCount: 8000,
            candidatesTokenCount: 250,
            totalTokenCount: 10250
          }
        }
      };

      const result = translateNonStreamingResponse(cachedAntigravityJson, FORMATS.ANTIGRAVITY, FORMATS.CLAUDE);
      expect(result.usage).toEqual({
        input_tokens: 2000,
        output_tokens: 250,
        cache_read_input_tokens: 8000
      });
    });

    it("handles missing or optional usage fields without fabricating values", () => {
      const noUsageJson = {
        response: {
          responseId: "resp_no_usage",
          modelVersion: "gemini-3.8-flash",
          candidates: [{ content: { role: "model", parts: [{ text: "no usage" }] }, finishReason: "STOP" }]
        }
      };

      const result = translateNonStreamingResponse(noUsageJson, FORMATS.ANTIGRAVITY, FORMATS.CLAUDE);
      expect(result.usage).toEqual({
        input_tokens: 0,
        output_tokens: 0
      });
      expect(result.usage.cache_read_input_tokens).toBeUndefined();
    });
  });

  // 8. Premature stream truncation detection without synthetic event leakage
  it("detects premature stream EOF without emitting synthetic message_stop or event:error", async () => {
    let completedPayload = null;
    const stream = createSSEStream({
      mode: "translate",
      targetFormat: FORMATS.ANTIGRAVITY,
      sourceFormat: FORMATS.CLAUDE,
      provider: "antigravity",
      model: "gemini-3.8-flash-high",
      onStreamComplete: (contentObj) => {
        completedPayload = contentObj;
      }
    });

    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();

    const emittedEvents = [];
    const readPromise = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        emittedEvents.push(new TextDecoder().decode(value));
      }
    })();

    const partialChunk = {
      response: {
        responseId: "resp_truncated_1",
        candidates: [{
          content: {
            role: "model",
            parts: [{ text: "Compacting conversation step 1..." }]
          }
        }]
      }
    };
    await writer.write(new TextEncoder().encode(`data: ${JSON.stringify(partialChunk)}\n\n`));
    await writer.close();
    await readPromise;

    const allEmitted = emittedEvents.join("");
    expect(allEmitted).not.toContain("event: message_stop");
    expect(allEmitted).not.toContain("event: error");
    expect(completedPayload).toBeDefined();
    expect(completedPayload.truncated).toBe(true);
  });

  // 9. Normally completed stream still emits the full terminal sequence
  it("emits the full terminal sequence for normally completed streams", async () => {
    let completedPayload = null;
    const stream = createSSEStream({
      mode: "translate",
      targetFormat: FORMATS.ANTIGRAVITY,
      sourceFormat: FORMATS.CLAUDE,
      provider: "antigravity",
      model: "gemini-3.8-flash-high",
      onStreamComplete: (contentObj) => {
        completedPayload = contentObj;
      }
    });

    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();

    const normalFinishChunk = {
      response: {
        responseId: "resp_normal_finish",
        candidates: [{
          content: {
            role: "model",
            parts: [{ text: "Compaction complete." }]
          },
          finishReason: "STOP"
        }],
        usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20, totalTokenCount: 120 }
      }
    };

    const emitted = [];
    const readPromise = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        emitted.push(new TextDecoder().decode(value));
      }
    })();

    await writer.write(new TextEncoder().encode(`data: ${JSON.stringify(normalFinishChunk)}\n\n`));
    await writer.close();
    await readPromise;

    const fullText = emitted.join("");
    expect(fullText).toContain("event: message_start");
    expect(fullText).toContain("event: message_delta");
    expect(fullText).toContain("event: message_stop");
    expect(completedPayload.truncated).toBe(false);
  });

});
