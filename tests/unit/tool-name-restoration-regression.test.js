import { describe, it, expect } from "vitest";
import { normalizeOpenAIToolNames, restoreOpenAIToolNames } from "../../open-sse/translator/concerns/toolCall.js";
import { createPassthroughStreamWithLogger } from "../../open-sse/utils/stream.js";

describe("Tool name restoration regression tests (End-to-End & Passthrough)", () => {
  const longName1 = "mcp__plugin_chrome-devtools-mcp-chrome-devtools__get_console_message";
  const longName2 = "mcp__plugin_chrome-devtools-mcp-chrome-devtools__take_screenshot";

  it("Test 1 — Non-streaming message-shaped restoration", () => {
    const reqBody = {
      tools: [
        { type: "function", function: { name: longName1 } }
      ]
    };
    const map = normalizeOpenAIToolNames(reqBody, 64);
    const alias1 = reqBody.tools[0].function.name;

    const providerResponse = {
      id: "chatcmpl-1",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            tool_calls: [
              { id: "call-1", type: "function", function: { name: alias1, arguments: '{"limit":5}' } }
            ]
          },
          finish_reason: "tool_calls"
        }
      ]
    };

    const restored = restoreOpenAIToolNames(providerResponse, map);
    expect(restored).toBe(true);
    expect(providerResponse.choices[0].message.tool_calls[0].function.name).toBe(longName1);
  });

  it("Test 2 & 3 — Streaming raw JSON & SSE message-shaped restoration in passthrough stream", async () => {
    const reqBody = {
      tools: [
        { type: "function", function: { name: longName1 } }
      ]
    };
    const map = normalizeOpenAIToolNames(reqBody, 64);
    const alias1 = reqBody.tools[0].function.name;

    // Test passing map to createPassthroughStreamWithLogger
    const passthroughStream = createPassthroughStreamWithLogger("nvidia", null, "test-model", "conn1", reqBody, null, null, map);
    const writer = passthroughStream.writable.getWriter();
    const reader = passthroughStream.readable.getReader();

    const readPromise = (async () => {
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
      return text;
    })();

    // Simulate provider sending raw JSON object line (NVIDIA passthrough non-SSE body)
    const rawJsonPayload = JSON.stringify({
      id: "chatcmpl-1",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            tool_calls: [
              { id: "call-1", type: "function", function: { name: alias1, arguments: '{"limit":5}' } }
            ]
          },
          finish_reason: "tool_calls"
        }
      ]
    }) + "\ndata: [DONE]\n";

    await writer.write(new TextEncoder().encode(rawJsonPayload));
    await writer.close();

    const output = await readPromise;
    expect(output).toContain(longName1);
    expect(output).not.toContain(alias1);
    expect(output).toContain("data: [DONE]");
  });

  it("Test 4 — No map handling", () => {
    const providerResponse = {
      choices: [
        {
          message: {
            tool_calls: [
              { function: { name: "custom_func" } }
            ]
          }
        }
      ]
    };

    const restoredNull = restoreOpenAIToolNames(providerResponse, null);
    expect(restoredNull).toBe(false);
    expect(providerResponse.choices[0].message.tool_calls[0].function.name).toBe("custom_func");

    const restoredEmpty = restoreOpenAIToolNames(providerResponse, new Map());
    expect(restoredEmpty).toBe(false);
    expect(providerResponse.choices[0].message.tool_calls[0].function.name).toBe("custom_func");
  });

  it("Test 5 — Multiple tool calls restoration", () => {
    const reqBody = {
      tools: [
        { type: "function", function: { name: longName1 } },
        { type: "function", function: { name: longName2 } }
      ]
    };
    const map = normalizeOpenAIToolNames(reqBody, 64);
    const alias1 = reqBody.tools[0].function.name;
    const alias2 = reqBody.tools[1].function.name;

    expect(alias1).not.toBe(alias2);

    const providerResponse = {
      choices: [
        {
          message: {
            tool_calls: [
              { function: { name: alias1 } },
              { function: { name: alias2 } }
            ]
          }
        }
      ]
    };

    const restored = restoreOpenAIToolNames(providerResponse, map);
    expect(restored).toBe(true);
    expect(providerResponse.choices[0].message.tool_calls[0].function.name).toBe(longName1);
    expect(providerResponse.choices[0].message.tool_calls[1].function.name).toBe(longName2);
  });

  it("Test 6 — Idempotency / Double restoration safety", () => {
    const reqBody = {
      tools: [{ type: "function", function: { name: longName1 } }]
    };
    const map = normalizeOpenAIToolNames(reqBody, 64);

    const providerResponse = {
      choices: [
        {
          message: {
            tool_calls: [{ function: { name: longName1 } }]
          }
        }
      ]
    };

    // Names are already original longName1. Restore attempt should return false and not mutate to undefined or corrupt name.
    const restoredAgain = restoreOpenAIToolNames(providerResponse, map);
    expect(restoredAgain).toBe(false);
    expect(providerResponse.choices[0].message.tool_calls[0].function.name).toBe(longName1);
  });

  it("Test 7 — handleNonStreamingResponse restores tool names on JSON response", async () => {
    const { handleNonStreamingResponse } = await import("../../open-sse/handlers/chatCore/nonStreamingHandler.js");

    const reqBody = {
      tools: [{ type: "function", function: { name: longName1 } }]
    };
    const map = normalizeOpenAIToolNames(reqBody, 64);
    const alias = reqBody.tools[0].function.name;

    const mockResponseObj = {
      id: "chatcmpl-1",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            tool_calls: [
              { id: "call-1", type: "function", function: { name: alias, arguments: "{}" } }
            ]
          },
          finish_reason: "tool_calls"
        }
      ]
    };

    const mockProviderResponse = new Response(JSON.stringify(mockResponseObj), {
      headers: { "Content-Type": "application/json" }
    });

    const result = await handleNonStreamingResponse({
      providerResponse: mockProviderResponse,
      provider: "nvidia",
      model: "meta/llama-3.1-8b-instruct",
      sourceFormat: "openai",
      targetFormat: "openai",
      body: reqBody,
      stream: false,
      toolNameMap: map,
      reqLogger: { logProviderResponse: () => {}, logConvertedResponse: () => {} },
      trackDone: () => {},
      appendLog: () => {}
    });

    const bodyText = await result.response.text();
    const parsed = JSON.parse(bodyText);
    expect(parsed.choices[0].message.tool_calls[0].function.name).toBe(longName1);
  });

  it("Test 8 — Stream chunking: JSON event split across multiple stream chunks", async () => {
    const reqBody = { tools: [{ type: "function", function: { name: longName1 } }] };
    const map = normalizeOpenAIToolNames(reqBody, 64);
    const alias1 = reqBody.tools[0].function.name;

    const passthroughStream = createPassthroughStreamWithLogger("nvidia", null, "test-model", "conn1", reqBody, null, null, map);
    const writer = passthroughStream.writable.getWriter();
    const reader = passthroughStream.readable.getReader();

    const readPromise = (async () => {
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
      return text;
    })();

    const fullEvent = `data: ${JSON.stringify({
      id: "chatcmpl-split",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: alias1, arguments: '{"arg":1}' } }] } }]
    })}\n\ndata: [DONE]\n\n`;

    // Split event across 3 partial chunks
    const chunk1 = fullEvent.slice(0, 20);
    const chunk2 = fullEvent.slice(20, 60);
    const chunk3 = fullEvent.slice(60);

    await writer.write(new TextEncoder().encode(chunk1));
    await writer.write(new TextEncoder().encode(chunk2));
    await writer.write(new TextEncoder().encode(chunk3));
    await writer.close();

    const output = await readPromise;
    expect(output).toContain(longName1);
    expect(output).not.toContain(alias1);
    expect(output).toContain("data: [DONE]");
  });

  it("Test 9 — Multiple SSE events in a single stream chunk", async () => {
    const reqBody = { tools: [{ type: "function", function: { name: longName1 } }] };
    const map = normalizeOpenAIToolNames(reqBody, 64);
    const alias1 = reqBody.tools[0].function.name;

    const passthroughStream = createPassthroughStreamWithLogger("nvidia", null, "test-model", "conn1", reqBody, null, null, map);
    const writer = passthroughStream.writable.getWriter();
    const reader = passthroughStream.readable.getReader();

    const readPromise = (async () => {
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
      return text;
    })();

    const event1 = `data: ${JSON.stringify({ choices: [{ delta: { content: "Hello " } }] })}\n\n`;
    const event2 = `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", type: "function", function: { name: alias1 } }] } }] })}\n\n`;
    const event3 = `data: [DONE]\n\n`;

    // Write all 3 events in 1 chunk
    await writer.write(new TextEncoder().encode(event1 + event2 + event3));
    await writer.close();

    const output = await readPromise;
    expect(output).toContain("Hello ");
    expect(output).toContain(longName1);
    expect(output).not.toContain(alias1);
    expect(output).toContain("data: [DONE]");
  });

  it("Test 10 — Non-JSON passthrough content & SSE comments remain unchanged", async () => {
    const passthroughStream = createPassthroughStreamWithLogger("nvidia", null, "test-model", "conn1", {}, null, null, new Map());
    const writer = passthroughStream.writable.getWriter();
    const reader = passthroughStream.readable.getReader();

    const readPromise = (async () => {
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += new TextDecoder().decode(value);
      }
      return text;
    })();

    const sseComment = `: ping comment\n\n`;
    const keepAlive = `: keep-alive\n\n`;

    await writer.write(new TextEncoder().encode(sseComment + keepAlive));
    await writer.close();

    const output = await readPromise;
    expect(output).toContain(": ping comment");
    expect(output).toContain(": keep-alive");
  });
});
