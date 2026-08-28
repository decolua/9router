import { describe, expect, it, vi } from "vitest";
import "./registerAll.js";
import { initState, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { collectToolSchemas } from "../../open-sse/translator/concerns/toolArguments.js";
import { translateNonStreamingResponse } from "../../open-sse/handlers/chatCore/nonStreamingHandler.js";

function run(events, tools = []) {
  const state = {
    ...initState(FORMATS.CLAUDE),
    toolSchemas: collectToolSchemas(tools),
  };
  return events.flatMap((event) => translateResponse(
    FORMATS.OPENAI,
    FORMATS.CLAUDE,
    event,
    state,
  ));
}

const bashTool = {
  name: "Bash",
  input_schema: {
    type: "object",
    properties: {
      command: { type: "string", minLength: 1 },
      description: { type: "string" },
    },
    required: ["command"],
    additionalProperties: false,
  },
};

describe("OpenAI to Claude tool argument guard", () => {
  it("emits a tool_use block only after fragmented arguments validate", () => {
    const output = run([
      { id: "chatcmpl-guard", model: "test", choices: [{ delta: { role: "assistant" }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "Bash", arguments: "{\"command\":" } }] }, finish_reason: null }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "\"echo ok\"}" } }] }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ], [bashTool]);

    expect(output.some((event) => event.type === "error")).toBe(false);
    expect(output.find((event) => event.type === "content_block_start" && event.content_block?.type === "tool_use")).toEqual(
      expect.objectContaining({ content_block: expect.objectContaining({ name: "Bash" }) }),
    );
    expect(output.find((event) => event.delta?.type === "input_json_delta")?.delta.partial_json).toBe("{\"command\":\"echo ok\"}");
  });

  it("normalizes stop to tool_use when a valid tool call is present", () => {
    const output = run([
      { id: "chatcmpl-guard", model: "test", choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "Bash", arguments: "{\"command\":\"echo ok\"}" } }] }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: "stop" }] },
    ], [bashTool]);

    expect(output.find((event) => event.type === "message_delta")?.delta.stop_reason).toBe("tool_use");
  });

  it("blocks truncated JSON without emitting tool_use", () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const output = run([
      { id: "chatcmpl-guard", model: "guard-model", choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "Bash", arguments: "{\"command\":\"secret-value" } }] }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ], [bashTool]);

    expect(output.some((event) => event.type === "error" && event.error?.type === "invalid_tool_arguments")).toBe(true);
    expect(output.some((event) => event.content_block?.type === "tool_use")).toBe(false);
    const audit = warning.mock.calls.flat().join(" ");
    expect(audit).toContain('"model":"guard-model"');
    expect(audit).toContain('"retryResult":"not_attempted_explicit_protocol_error"');
    expect(audit).toContain('"fragments"');
    expect(audit).not.toContain("secret-value");
    warning.mockRestore();
  });

  it("blocks schema-invalid arguments", () => {
    const output = run([
      { id: "chatcmpl-guard", model: "test", choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "Bash", arguments: "{\"description\":\"missing command\"}" } }] }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: "tool_calls" }] },
    ], [bashTool]);

    expect(output.find((event) => event.type === "error")?.error.message).toContain("$.command is required");
  });

  it("blocks tool arguments completed with length finish reason", () => {
    const output = run([
      { id: "chatcmpl-guard", model: "test", choices: [{ delta: { tool_calls: [{ index: 0, id: "call_1", function: { name: "Bash", arguments: "{\"command\":\"echo ok\"}" } }] }, finish_reason: null }] },
      { choices: [{ delta: {}, finish_reason: "length" }] },
    ], [bashTool]);

    expect(output.find((event) => event.type === "error")?.error.message).toContain("finish_reason=length");
  });

  it("rejects malformed non-streaming tool arguments before creating tool_use", () => {
    const response = {
      id: "chatcmpl-nonstream",
      model: "guard-model",
      choices: [{
        finish_reason: "tool_calls",
        message: {
          tool_calls: [{
            id: "call_1",
            function: { name: "Bash", arguments: "{\"command\":\"unterminated" },
          }],
        },
      }],
    };

    expect(() => translateNonStreamingResponse(
      response,
      FORMATS.OPENAI,
      FORMATS.CLAUDE,
      null,
      collectToolSchemas([bashTool]),
    )).toThrow(/invalid arguments for tool Bash/);
  });

  it("normalizes non-streaming stop to tool_use when a tool call is present", () => {
    const response = {
      id: "chatcmpl-nonstream",
      model: "guard-model",
      choices: [{
        finish_reason: "stop",
        message: {
          tool_calls: [{
            id: "call_1",
            function: { name: "Bash", arguments: "{\"command\":\"echo ok\"}" },
          }],
        },
      }],
    };

    const translated = translateNonStreamingResponse(
      response,
      FORMATS.OPENAI,
      FORMATS.CLAUDE,
      null,
      collectToolSchemas([bashTool]),
    );

    expect(translated.stop_reason).toBe("tool_use");
  });
});
