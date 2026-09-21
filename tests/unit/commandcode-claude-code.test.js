import { describe, expect, it } from "vitest";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState, translateRequest, translateResponse } from "../../open-sse/translator/index.js";

describe("Claude Code through Command Code", () => {
  it("preserves tool names across Claude tool_use and tool_result turns", () => {
    const request = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.COMMANDCODE,
      "deepseek/deepseek-v4-flash",
      {
        max_tokens: 4096,
        system: "Use tools when needed.",
        tools: [{
          name: "Bash",
          description: "Run a command",
          input_schema: { type: "object", properties: { command: { type: "string" } } },
        }],
        messages: [
          { role: "user", content: "run pwd" },
          {
            role: "assistant",
            content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "pwd" } }],
          },
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "/tmp" }],
          },
        ],
      },
      true,
      null,
      "commandcode",
    );

    expect(request).toMatchObject({
      memory: "",
      taste: "",
      skills: null,
      permissionMode: "standard",
    });
    expect(request.params.tools[0]).toMatchObject({ type: "function", name: "Bash" });
    const toolResult = request.params.messages.find((message) => message.role === "tool");
    expect(toolResult.content[0]).toMatchObject({
      type: "tool-result",
      toolCallId: "toolu_1",
      toolName: "Bash",
    });
  });

  it("returns only the final authoritative tool call to Claude Code", () => {
    const state = initState(FORMATS.CLAUDE);
    const events = [
      { type: "tool-input-start", id: "toolu_2", toolName: "Read" },
      { type: "tool-input-delta", id: "toolu_2", delta: '{"file_path":"draft"}' },
      { type: "tool-input-end", id: "toolu_2" },
      {
        type: "tool-call",
        toolCallId: "toolu_2",
        toolName: "Read",
        input: { file_path: "/tmp/final" },
      },
      {
        type: "finish",
        finishReason: "tool-calls",
        totalUsage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
      },
    ];

    const output = events.flatMap((event) =>
      translateResponse(FORMATS.COMMANDCODE, FORMATS.CLAUDE, event, state)
    );
    const toolStart = output.find((event) => event.type === "content_block_start" && event.content_block?.type === "tool_use");
    const inputDelta = output.find((event) => event.delta?.type === "input_json_delta");
    const messageDelta = output.find((event) => event.type === "message_delta");

    expect(toolStart.content_block).toMatchObject({ id: "toolu_2", name: "Read" });
    expect(inputDelta.delta.partial_json).toBe('{"file_path":"/tmp/final"}');
    expect(messageDelta.delta.stop_reason).toBe("tool_use");
    expect(output.filter((event) => event.content_block?.type === "tool_use")).toHaveLength(1);
  });
});
