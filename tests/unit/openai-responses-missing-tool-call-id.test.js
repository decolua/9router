/**
 * Regression: a Responses-API `function_call_output` item that arrives WITHOUT
 * `call_id` (clients do drop it) used to be translated into a Chat Completions
 * tool message with `tool_call_id: undefined` — a key `JSON.stringify` silently
 * removes. Every strict upstream then rejects the WHOLE request:
 *
 *   NVIDIA NIM     400 "Failed to deserialize the JSON body into the target type:
 *                      missing field `tool_call_id`"
 *   OpenAI-compat  400 tool message must be a response to a message with tool_calls
 *   OpenCode Zen   400 "Error from provider (Console): Upstream request failed: [400]"
 *
 * A single malformed item therefore killed every model in a combo (503
 * "All models failed"). The correlation id must be recovered by pairing the
 * output with the pending tool call — or the payload must stop being a tool
 * message at all (downgraded to user context).
 */
import { describe, it, expect } from "vitest";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";
import { convertResponsesApiFormat } from "../../open-sse/translator/formats/responsesApi.js";
import { ensureToolCallIds } from "../../open-sse/translator/concerns/toolCall.js";

const TOOLS = [
  {
    type: "function",
    name: "exec_command",
    description: "run a command",
    parameters: { type: "object", properties: { cmd: { type: "string" } }, required: ["cmd"] },
  },
];

const user = (text) => ({ type: "message", role: "user", content: [{ type: "input_text", text }] });
const call = (callId) => ({
  type: "function_call",
  name: "exec_command",
  arguments: JSON.stringify({ cmd: "ls" }),
  ...(callId ? { call_id: callId } : {}),
});
const toolMessages = (body) => body.messages.filter((m) => m.role === "tool");
/** every tool message must survive serialization with a non-empty string id */
const serializedToolIds = (body) =>
  JSON.parse(JSON.stringify(body))
    .messages.filter((m) => m.role === "tool")
    .map((m) => m.tool_call_id);

describe("Responses tool output without call_id", () => {
  it("pairs the orphan output with the pending function_call", () => {
    const body = openaiResponsesToOpenAIRequest(
      "nvidia/z-ai/glm-5.3",
      { input: [user("rode a tool"), call("call_abc"), { type: "function_call_output", output: "ok" }], tools: TOOLS },
      false,
      {}
    );

    const toolMsgs = toolMessages(body);
    expect(toolMsgs).toHaveLength(1);
    expect(toolMsgs[0].tool_call_id).toBe("call_abc");
    // the assistant tool call and the tool result still answer each other
    const assistantCallIds = body.messages
      .filter((m) => m.role === "assistant" && m.tool_calls)
      .flatMap((m) => m.tool_calls.map((tc) => tc.id));
    expect(assistantCallIds).toContain("call_abc");
    expect(serializedToolIds(body).every((id) => typeof id === "string" && id.length > 0)).toBe(true);
  });

  it("keeps ids consistent when the function_call item itself lost call_id", () => {
    const body = openaiResponsesToOpenAIRequest(
      "nvidia/z-ai/glm-5.3",
      { input: [user("rode a tool"), call(), { type: "function_call_output", output: "ok" }], tools: TOOLS },
      false,
      {}
    );

    const [assistantCallId] = body.messages
      .filter((m) => m.role === "assistant" && m.tool_calls)
      .flatMap((m) => m.tool_calls.map((tc) => tc.id));
    const [toolId] = serializedToolIds(body);
    expect(typeof assistantCallId).toBe("string");
    expect(toolId).toBe(assistantCallId);
  });

  it("preserves parallel outputs in order", () => {
    const body = openaiResponsesToOpenAIRequest(
      "m",
      {
        input: [
          user("rode duas tools"),
          call("call_1"),
          call("call_2"),
          { type: "function_call_output", output: "first" },
          { type: "function_call_output", output: "second" },
        ],
        tools: TOOLS,
      },
      false,
      {}
    );

    expect(toolMessages(body).map((m) => [m.tool_call_id, m.content])).toEqual([
      ["call_1", "first"],
      ["call_2", "second"],
    ]);
  });

  it("strips an output with no matching function_call (orphan contract, #2236)", () => {
    const body = openaiResponsesToOpenAIRequest(
      "m",
      { input: [user("oi"), { type: "function_call_output", output: "late result" }], tools: TOOLS },
      false,
      {}
    );

    expect(toolMessages(body)).toHaveLength(0);
    // no unpairable tool message survives, and the orphan text does not leak in as a
    // stray user turn either
    expect(JSON.stringify(body.messages)).not.toContain("late result");
    expect(serializedToolIds(body)).toEqual([]);
  });

  it("custom_tool_call_output without call_id is repaired too", () => {
    const body = openaiResponsesToOpenAIRequest(
      "m",
      {
        input: [
          user("apply a patch"),
          { type: "custom_tool_call", name: "apply_patch", input: "*** Begin Patch" },
          { type: "custom_tool_call_output", output: "Done!" },
        ],
        tools: [{ type: "custom", name: "apply_patch", description: "patch", format: { type: "grammar" } }],
      },
      false,
      {}
    );

    const [toolId] = serializedToolIds(body);
    const [assistantCallId] = body.messages
      .filter((m) => m.role === "assistant" && m.tool_calls)
      .flatMap((m) => m.tool_calls.map((tc) => tc.id));
    expect(toolId).toBe(assistantCallId);
    expect(toolId.length).toBeGreaterThan(0);
  });

  it("convertResponsesApiFormat (responsesHandler path) never emits an id-less tool message", () => {
    const body = convertResponsesApiFormat({
      input: [user("rode a tool"), call("call_abc"), { type: "function_call_output", output: "ok" }],
      tools: TOOLS,
    });

    expect(serializedToolIds(body)).toEqual(["call_abc"]);
    const onlyIdless = convertResponsesApiFormat({
      input: [user("oi"), { type: "function_call_output", output: "late" }],
      tools: TOOLS,
    });
    expect(JSON.parse(JSON.stringify(onlyIdless)).messages.filter((m) => m.role === "tool")).toEqual([]);
  });

  it("ensureToolCallIds repairs a chat-format tool message without tool_call_id", () => {
    const body = ensureToolCallIds({
      messages: [
        { role: "user", content: "oi" },
        {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call_chat_1", type: "function", function: { name: "echo", arguments: "{}" } }],
        },
        { role: "tool", content: "resultado" },
      ],
    });

    const toolMsgs = body.messages.filter((m) => m.role === "tool");
    expect(toolMsgs).toHaveLength(1);
    expect(toolMsgs[0].tool_call_id).toBe("call_chat_1");
    expect(JSON.parse(JSON.stringify(body)).messages.filter((m) => m.role === "tool").every((m) => !!m.tool_call_id)).toBe(true);
  });
});
