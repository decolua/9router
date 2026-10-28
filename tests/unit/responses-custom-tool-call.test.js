/**
 * Regression tests for #4276
 *
 * A Responses API request with tools:[{type:"custom",name:"exec",...}] whose
 * model answer calls exec received a function_call item in the SSE stream.
 * Codex expects a custom_tool_call item and fatally errors:
 *   "tool exec invoked with incompatible payload"
 *
 * Two fixes:
 *
 * 1. responsesApi.js — convertResponsesApiFormat now handles custom_tool_call
 *    and custom_tool_call_output input items, converting them to standard
 *    function_call tool_calls for providers (inbound direction).
 *
 * 2. responsesTransformer.js — createResponsesApiTransformStream now accepts
 *    a Set of custom tool names. When a tool call's name is in that set the
 *    transformer emits custom_tool_call (with .input) instead of function_call
 *    (with .arguments) (outbound direction).
 */

import { describe, it, expect } from "vitest";
import { convertResponsesApiFormat } from "../../open-sse/translator/formats/responsesApi.js";
import { createResponsesApiTransformStream } from "../../open-sse/transformer/responsesTransformer.js";

// ── inbound: custom_tool_call input items → function_call ─────────────────

describe("convertResponsesApiFormat — custom_tool_call input (#4276)", () => {
  it("converts a custom_tool_call item to an assistant function_call", () => {
    const body = {
      model: "test",
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "run it" }] },
        { type: "custom_tool_call", call_id: "cu_1", name: "exec", input: "ls -la" }
      ]
    };
    const result = convertResponsesApiFormat(body);
    const assistantMsg = result.messages.find(m => m.role === "assistant");
    expect(assistantMsg).toBeDefined();
    expect(assistantMsg.tool_calls).toHaveLength(1);
    expect(assistantMsg.tool_calls[0].function.name).toBe("exec");
    expect(assistantMsg.tool_calls[0].id).toBe("cu_1");
    // input should be JSON-wrapped for provider compatibility
    const args = JSON.parse(assistantMsg.tool_calls[0].function.arguments);
    expect(args.input).toBe("ls -la");
  });

  it("converts a custom_tool_call_output item to a tool result", () => {
    const body = {
      model: "test",
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "run it" }] },
        { type: "custom_tool_call", call_id: "cu_1", name: "exec", input: "ls -la" },
        { type: "custom_tool_call_output", call_id: "cu_1", output: "file1.js\nfile2.js" }
      ]
    };
    const result = convertResponsesApiFormat(body);
    const toolMsg = result.messages.find(m => m.role === "tool");
    expect(toolMsg).toBeDefined();
    expect(toolMsg.tool_call_id).toBe("cu_1");
    expect(toolMsg.content).toBe("file1.js\nfile2.js");
  });
});

// ── outbound: transformer emits custom_tool_call for named custom tools ────

async function runTransform(inputChunks, customToolNames = new Set()) {
  const stream = createResponsesApiTransformStream(null, customToolNames);
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const events = [];
  const decoder = new TextDecoder();

  (async () => {
    for (const chunk of inputChunks) {
      await writer.write(new TextEncoder().encode(chunk));
    }
    await writer.close();
  })();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    for (const block of decoder.decode(value).split("\n\n")) {
      const m = block.match(/^event:\s*(\S+)\ndata:\s*(.+)$/s);
      if (m) events.push({ type: m[1], data: JSON.parse(m[2]) });
    }
  }
  return events;
}

function makeToolCallStream(callId, toolName, argsJson) {
  const id = "chatcmpl-tc001";
  return [
    `data: ${JSON.stringify({ id, choices: [{ index: 0, delta: { role: "assistant", content: null }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ id, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: callId, type: "function", function: { name: toolName, arguments: "" } }] }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ id, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: argsJson } }] }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ id, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`,
    `data: [DONE]\n\n`
  ];
}

describe("createResponsesApiTransformStream — custom_tool_call output (#4276)", () => {
  it("emits custom_tool_call when tool name is in customToolNames set", async () => {
    const chunks = makeToolCallStream("cu_1", "exec", JSON.stringify({ input: "ls -la" }));
    const events = await runTransform(chunks, new Set(["exec"]));

    const done = events.find(e => e.type === "response.output_item.done");
    expect(done).toBeDefined();
    expect(done.data.item.type).toBe("custom_tool_call");
    expect(done.data.item.name).toBe("exec");
    expect(done.data.item.input).toBe("ls -la");   // unwrapped from {input:...}
    expect(done.data.item.call_id).toBe("cu_1");
    // must NOT have .arguments
    expect(done.data.item.arguments).toBeUndefined();
  });

  it("emits function_call when tool name is NOT in customToolNames set", async () => {
    const chunks = makeToolCallStream("call_abc", "search", JSON.stringify({ q: "hello" }));
    const events = await runTransform(chunks, new Set(["exec"]));

    const done = events.find(e => e.type === "response.output_item.done");
    expect(done).toBeDefined();
    expect(done.data.item.type).toBe("function_call");
    expect(done.data.item.name).toBe("search");
    expect(done.data.item.arguments).toBeDefined();
  });

  it("emits function_call when customToolNames is empty (default behaviour)", async () => {
    const chunks = makeToolCallStream("call_xyz", "bash", JSON.stringify({ cmd: "echo hi" }));
    const events = await runTransform(chunks);  // no customToolNames

    const done = events.find(e => e.type === "response.output_item.done");
    expect(done).toBeDefined();
    expect(done.data.item.type).toBe("function_call");
  });

  it("custom_tool_call item appears in response.completed.output", async () => {
    const chunks = makeToolCallStream("cu_2", "exec", JSON.stringify({ input: "pwd" }));
    const events = await runTransform(chunks, new Set(["exec"]));

    const completed = events.find(e => e.type === "response.completed");
    expect(completed).toBeDefined();
    const output = completed.data.response.output;
    expect(output.some(o => o.type === "custom_tool_call")).toBe(true);
  });
});