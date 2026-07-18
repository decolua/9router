import { describe, expect, it } from "vitest";
import { KiroExecutor, validateKiroToolUse } from "../../open-sse/executors/kiro.js";
import { openaiToOpenAIResponsesResponse } from "../../open-sse/translator/response/openai-responses.js";
import { createSSETransformStreamWithLogger } from "../../open-sse/utils/stream.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

function encodeHeader(name, value) {
  const nameBytes = new TextEncoder().encode(name);
  const valueBytes = new TextEncoder().encode(value);
  const out = new Uint8Array(1 + nameBytes.length + 1 + 2 + valueBytes.length);
  let offset = 0;
  out[offset++] = nameBytes.length;
  out.set(nameBytes, offset);
  offset += nameBytes.length;
  out[offset++] = 7;
  out[offset++] = (valueBytes.length >> 8) & 0xff;
  out[offset++] = valueBytes.length & 0xff;
  out.set(valueBytes, offset);
  return out;
}

function encodeEventFrame(eventType, payload) {
  const headers = encodeHeader(":event-type", eventType);
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const totalLength = 12 + headers.length + payloadBytes.length + 4;
  const frame = new Uint8Array(totalLength);
  const view = new DataView(frame.buffer);
  view.setUint32(0, totalLength, false);
  view.setUint32(4, headers.length, false);
  view.setUint32(8, 0, false);
  frame.set(headers, 12);
  frame.set(payloadBytes, 12 + headers.length);
  view.setUint32(totalLength - 4, 0, false);
  return frame;
}

async function collectText(stream) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function collectDataChunks(text) {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6).trim())
    .filter((data) => data && data !== "[DONE]")
    .map((data) => JSON.parse(data));
}

describe("Kiro nested tool_call validation", () => {
  it("accepts a valid wrapper tool_call with nested name and arguments", () => {
    expect(() => validateKiroToolUse({
      toolUseId: "call_1",
      name: "tool_call",
      input: { name: "mcp_search", arguments: { q: "router" } }
    })).not.toThrow();
  });

  it("accepts ordinary provider tool calls without requiring wrapper fields", () => {
    expect(() => validateKiroToolUse({
      toolUseId: "call_1",
      name: "get_weather",
      input: { city: "Taipei" }
    })).not.toThrow();
  });

  it("rejects missing or empty Kiro tool names", () => {
    expect(() => validateKiroToolUse({ toolUseId: "call_1", input: {} }))
      .toThrow(/missing tool name/);
    expect(() => validateKiroToolUse({ toolUseId: "call_1", name: "   ", input: {} }))
      .toThrow(/missing tool name/);
  });

  it("rejects wrapper tool_call payloads without the real MCP tool name", () => {
    expect(() => validateKiroToolUse({
      toolUseId: "call_1",
      name: "tool_call",
      input: { arguments: { q: "router" } }
    })).toThrow(/missing nested MCP tool name/);

    expect(() => validateKiroToolUse({
      toolUseId: "call_1",
      name: "tool_call",
      input: { name: "  ", arguments: {} }
    })).toThrow(/missing nested MCP tool name/);
  });

  it("rejects malformed wrapper JSON and missing nested arguments", () => {
    expect(() => validateKiroToolUse({
      toolUseId: "call_1",
      name: "tool_call",
      input: "{\"name\":\"mcp_search\","
    })).toThrow(/valid JSON/);

    expect(() => validateKiroToolUse({
      toolUseId: "call_1",
      name: "tool_call",
      input: { name: "mcp_search" }
    })).toThrow(/missing nested MCP tool arguments/);
  });

  it("emits an actionable stream error instead of a fake legal tool call", async () => {
    const executor = new KiroExecutor();
    const frames = [
      encodeEventFrame("toolUseEvent", {
        toolUseId: "call_1",
        name: "tool_call",
        input: { arguments: { q: "router" } }
      }),
      encodeEventFrame("messageStopEvent", {})
    ];
    const response = new Response(new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(frame);
        controller.close();
      }
    }), { status: 200, statusText: "OK" });

    const transformed = executor.transformEventStreamToSSE(response, "kr/claude-opus-4.8");
    const text = await collectText(transformed.body);

    expect(text).toContain("invalid_kiro_tool_call");
    expect(text).toContain("missing nested MCP tool name");
    expect(text).not.toContain("\"tool_calls\"");
    expect(text).toContain("data: [DONE]");
  });

  it("allows a wrapper init frame without input and validates after string fragments", async () => {
    const executor = new KiroExecutor();
    const frames = [
      encodeEventFrame("toolUseEvent", {
        toolUseId: "call_1",
        name: "tool_call"
      }),
      encodeEventFrame("toolUseEvent", {
        toolUseId: "call_1",
        name: "tool_call",
        input: "{\"name\":\"mcp_search\","
      }),
      encodeEventFrame("toolUseEvent", {
        toolUseId: "call_1",
        name: "tool_call",
        input: "\"arguments\":{\"q\":\"router\"}}"
      }),
      encodeEventFrame("messageStopEvent", {})
    ];
    const response = new Response(new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(frame);
        controller.close();
      }
    }), { status: 200, statusText: "OK" });

    const transformed = executor.transformEventStreamToSSE(response, "kr/claude-opus-4.8");
    const text = await collectText(transformed.body);
    const chunks = collectDataChunks(text);
    const toolChunks = chunks.flatMap((chunk) => chunk.choices?.[0]?.delta?.tool_calls || []);
    const args = toolChunks.map((toolCall) => toolCall.function?.arguments || "").join("");

    expect(text).not.toContain("invalid_kiro_tool_call");
    expect(toolChunks[0].function.name).toBe("tool_call");
    expect(JSON.parse(args)).toEqual({ name: "mcp_search", arguments: { q: "router" } });
    expect(chunks.at(-1).choices[0].finish_reason).toBe("tool_calls");
  });

  it("waits for the final growing object payload before validating wrapper fields", async () => {
    const executor = new KiroExecutor();
    const frames = [
      encodeEventFrame("toolUseEvent", {
        toolUseId: "call_1",
        name: "tool_call",
        input: { arguments: { q: "router" } }
      }),
      encodeEventFrame("toolUseEvent", {
        toolUseId: "call_1",
        name: "tool_call",
        input: { name: "mcp_search", arguments: { q: "router" } }
      }),
      encodeEventFrame("meteringEvent", {}),
      encodeEventFrame("contextUsageEvent", { contextUsagePercentage: 1 })
    ];
    const response = new Response(new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(frame);
        controller.close();
      }
    }), { status: 200, statusText: "OK" });

    const transformed = executor.transformEventStreamToSSE(response, "kr/claude-opus-4.8");
    const text = await collectText(transformed.body);
    const chunks = collectDataChunks(text);
    const toolChunks = chunks.flatMap((chunk) => chunk.choices?.[0]?.delta?.tool_calls || []);
    const args = toolChunks.map((toolCall) => toolCall.function?.arguments || "").join("");

    expect(text).not.toContain("invalid_kiro_tool_call");
    expect(JSON.parse(args)).toEqual({ name: "mcp_search", arguments: { q: "router" } });
    expect(chunks.at(-1).usage).toBeDefined();
  });

  it("preserves monotonic emitted tool indices when a wrapper is buffered before a direct tool", async () => {
    const executor = new KiroExecutor();
    const frames = [
      encodeEventFrame("toolUseEvent", {
        toolUseId: "wrapper_1",
        name: "tool_call",
        input: { name: "mcp_search", arguments: { q: "router" } }
      }),
      encodeEventFrame("toolUseEvent", {
        toolUseId: "direct_1",
        name: "read_file",
        input: { path: "README.md" }
      }),
      encodeEventFrame("messageStopEvent", {})
    ];
    const response = new Response(new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(frame);
        controller.close();
      }
    }), { status: 200, statusText: "OK" });

    const transformed = executor.transformEventStreamToSSE(response, "kr/claude-opus-4.8");
    const text = await collectText(transformed.body);
    const chunks = collectDataChunks(text);
    const toolStarts = chunks
      .flatMap((chunk) => chunk.choices?.[0]?.delta?.tool_calls || [])
      .filter((toolCall) => toolCall.id);

    expect(text).not.toContain("invalid_kiro_tool_call");
    expect(toolStarts.map((toolCall) => toolCall.function.name)).toEqual(["read_file", "tool_call"]);
    expect(toolStarts.map((toolCall) => toolCall.index)).toEqual([0, 1]);
  });

  it("fails malformed final wrapper payloads without emitting a legal tool_call", async () => {
    const executor = new KiroExecutor();
    const frames = [
      encodeEventFrame("toolUseEvent", {
        toolUseId: "call_1",
        name: "tool_call"
      }),
      encodeEventFrame("toolUseEvent", {
        toolUseId: "call_1",
        name: "tool_call",
        input: { arguments: { q: "router" } }
      }),
      encodeEventFrame("messageStopEvent", {})
    ];
    const response = new Response(new ReadableStream({
      start(controller) {
        for (const frame of frames) controller.enqueue(frame);
        controller.close();
      }
    }), { status: 200, statusText: "OK" });

    const transformed = executor.transformEventStreamToSSE(response, "kr/claude-opus-4.8");
    const text = await collectText(transformed.body);

    expect(text).toContain("invalid_kiro_tool_call");
    expect(text).toContain("missing nested MCP tool name");
    expect(text).not.toContain("\"tool_calls\"");
    expect(text).toContain("data: [DONE]");
  });

  it("cancels the upstream response body after an invalid wrapper payload", async () => {
    const executor = new KiroExecutor();
    const frames = [
      encodeEventFrame("toolUseEvent", {
        toolUseId: "call_1",
        name: "tool_call",
        input: { arguments: { q: "router" } }
      }),
      encodeEventFrame("messageStopEvent", {})
    ];
    let cancelReason;
    const cancelPromise = new Promise((resolve) => {
      const response = new Response(new ReadableStream({
        start(controller) {
          for (const frame of frames) controller.enqueue(frame);
        },
        cancel(reason) {
          cancelReason = reason;
          resolve(reason);
        }
      }), { status: 200, statusText: "OK" });

      const transformed = executor.transformEventStreamToSSE(response, "kr/claude-opus-4.8");
      collectText(transformed.body).catch(resolve);
    });

    const result = await Promise.race([
      cancelPromise,
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 250))
    ]);

    expect(result).not.toBe("timeout");
    expect(cancelReason).toBeDefined();
  });

  it("translates Kiro stream errors into Responses response.failed events", async () => {
    const transform = createSSETransformStreamWithLogger(
      FORMATS.KIRO,
      FORMATS.OPENAI_RESPONSES,
      "kiro",
      null,
      null,
      "kr/claude-opus-4.8"
    );
    const writer = transform.writable.getWriter();
    const readPromise = collectText(transform.readable);
    await writer.write(new TextEncoder().encode(
      "data: {\"error\":{\"message\":\"Invalid Kiro tool_call payload: missing nested MCP tool name at input.name\",\"type\":\"invalid_request_error\",\"code\":\"invalid_kiro_tool_call\"}}\n\n"
    ));
    await writer.close();

    const text = await readPromise;

    expect(text).toContain("event: response.failed");
    expect(text).toContain("invalid_kiro_tool_call");
    expect(text).toContain("missing nested MCP tool name");
    expect(text).not.toContain("response.output_item.added");
    expect(text).toContain("data: [DONE]");
  });

  it("does not change non-Kiro OpenAI function_call translation", () => {
    const state = {
      seq: 0,
      responseId: "resp_test",
      created: 1,
      started: false,
      msgTextBuf: {},
      msgItemAdded: {},
      msgContentAdded: {},
      msgItemDone: {},
      reasoningId: "",
      reasoningIndex: -1,
      reasoningBuf: "",
      funcArgsBuf: {},
      funcNames: {},
      funcCallIds: {},
      funcArgsDone: {},
      funcItemDone: {},
      completedSent: false
    };
    const events = openaiToOpenAIResponsesResponse({
      id: "chatcmpl_test",
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{
            index: 0,
            id: "call_1",
            type: "function",
            function: { name: "tool_call", arguments: "{\"arguments\":{}}" }
          }]
        },
        finish_reason: null
      }]
    }, state);

    expect(events.some((event) => event.data?.item?.name === "tool_call")).toBe(true);
  });
});
