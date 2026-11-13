/**
 * One Responses assistant turn = ONE Chat Completions assistant message.
 *
 * Codex replays a turn as `message` (the visible text) + `reasoning` + N
 * `function_call` items. Emitting those as two consecutive assistant messages
 * makes thinking-mode upstreams reject the whole request with
 * CodeBuddy 11155 "the reasoning content from the previous turn must be passed
 * back in thinking mode" as soon as the request declares tools.
 */
import { describe, it, expect } from "vitest";
import { openaiResponsesToOpenAIRequest } from "../../open-sse/translator/request/openai-responses.js";

// output_text/input_text are converted to Chat Completions text blocks.
const text = (t) => [{ type: "text", text: t }];
const asInput = (t) => [{ type: "output_text", text: t }];

const turn = () => [
  { type: "message", role: "user", content: [{ type: "input_text", text: "介绍一下这个项目" }] },
  { type: "message", role: "assistant", content: asInput("我先查看项目结构。") },
  { type: "reasoning", summary: [{ type: "summary_text", text: "先 ls 再读 README" }] },
  {
    type: "function_call",
    call_id: "call_1",
    name: "exec_command",
    arguments: JSON.stringify({ cmd: "ls -la" }),
  },
  {
    type: "function_call",
    call_id: "call_2",
    name: "exec_command",
    arguments: JSON.stringify({ cmd: "cat README.md" }),
  },
  { type: "function_call_output", call_id: "call_1", output: "a.txt\nb.txt" },
  { type: "function_call_output", call_id: "call_2", output: "# Laya" },
];

describe("responses→openai assistant turn merging", () => {
  it("merges the assistant message with the tool calls that follow it", () => {
    const out = openaiResponsesToOpenAIRequest("deepseek-v4.1-flash", { model: "m", input: turn() }, true, null);

    const assistants = out.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);

    const [assistant] = assistants;
    expect(assistant.tool_calls).toHaveLength(2);
    expect(assistant.tool_calls.map((tc) => tc.id)).toEqual(["call_1", "call_2"]);
    // The visible text is kept, not dropped in favour of content: null.
    expect(assistant.content).toEqual(text("我先查看项目结构。"));
  });

  it("attaches reasoning that arrives after the message to the same turn", () => {
    const out = openaiResponsesToOpenAIRequest("deepseek-v4.1-flash", { model: "m", input: turn() }, true, null);

    const assistants = out.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0].reasoning_content).toBe("先 ls 再读 README");
  });

  it("keeps tool result ordering: assistant turn, then its tool messages", () => {
    const out = openaiResponsesToOpenAIRequest("deepseek-v4.1-flash", { model: "m", input: turn() }, true, null);

    expect(out.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "tool"]);
    expect(out.messages[2].tool_call_id).toBe("call_1");
    expect(out.messages[3].tool_call_id).toBe("call_2");
  });

  it("does not emit an empty tool_calls array for a plain assistant message", () => {
    const out = openaiResponsesToOpenAIRequest(
      "deepseek-v4.1-flash",
      {
        model: "m",
        input: [
          { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
          { type: "message", role: "assistant", content: asInput("hello") },
          { type: "message", role: "user", content: [{ type: "input_text", text: "again" }] },
        ],
      },
      true,
      null
    );

    const assistants = out.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0]).not.toHaveProperty("tool_calls");
    expect(out.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
  });

  it("merges when the tool calls precede the assistant message", () => {
    const out = openaiResponsesToOpenAIRequest(
      "deepseek-v4.1-flash",
      {
        model: "m",
        input: [
          { type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] },
          { type: "function_call", call_id: "call_1", name: "exec_command", arguments: "{}" },
          { type: "message", role: "assistant", content: asInput("查完了") },
          { type: "function_call_output", call_id: "call_1", output: "ok" },
        ],
      },
      true,
      null
    );

    const assistants = out.messages.filter((m) => m.role === "assistant");
    expect(assistants).toHaveLength(1);
    expect(assistants[0].content).toEqual(text("查完了"));
    expect(assistants[0].tool_calls).toHaveLength(1);
  });
});
