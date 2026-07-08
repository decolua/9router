// Claude → Kiro (direct route) request translation + Kiro → Claude response.
// Verifies the direct claude:kiro / kiro:claude routes added to bypass the
// OpenAI pivot, and that the "Improperly formed request" 400-guards survive.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const C2K = (body) =>
  translateRequest(FORMATS.CLAUDE, FORMATS.KIRO, "claude-sonnet-4.5", body, true, null, "kiro");

describe("Claude → Kiro (direct route)", () => {
  it("produces a Kiro conversationState payload", () => {
    const out = C2K({ messages: [{ role: "user", content: "hello" }] });
    expect(out.conversationState).toBeTruthy();
    expect(out.conversationState.currentMessage.userInputMessage.content).toContain("hello");
  });

  it("guard 1: with no tools, a dangling tool_result is flattened to text (no structured ref)", () => {
    // Client omitted `tools` but kept a tool_result after compaction.
    const out = C2K({
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "f", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "result" }] },
      ],
    });
    // No userInputMessageContext.tools/toolResults anywhere → won't trip the
    // "tools required" validator.
    const cur = out.conversationState.currentMessage.userInputMessage;
    expect(cur.userInputMessageContext?.toolResults).toBeFalsy();
    const everyHistoryClean = out.conversationState.history.every(
      (h) => !h.userInputMessage?.userInputMessageContext?.toolResults
    );
    expect(everyHistoryClean).toBe(true);
  });

  it("guard 2: with tools, an orphaned tool_result is folded into user text", () => {
    const out = C2K({
      tools: [{ name: "f", description: "fn", input_schema: { type: "object", properties: {} } }],
      messages: [
        { role: "user", content: "go" },
        // tool_result references a tool_use that never appears → orphan
        { role: "user", content: [{ type: "tool_result", tool_use_id: "ghost", content: "salvage me" }] },
      ],
    });
    const cur = out.conversationState.currentMessage.userInputMessage;
    // The orphan content survives as text, not as a dangling structured ref.
    expect(cur.content).toContain("salvage me");
    expect(cur.userInputMessageContext?.toolResults?.length ?? 0).toBe(0);
  });

  it("nests adaptive thinking field when model implies thinking (no tag)", () => {
    const out = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.KIRO,
      "claude-sonnet-4.5-thinking",
      { messages: [{ role: "user", content: "hi" }] },
      true,
      null,
      "kiro"
    );
    // Real Kiro signals reasoning via the nested thinking field, never a content tag.
    expect(out.conversationState.currentMessage.userInputMessage.content).not.toContain(
      "<thinking_mode"
    );
    expect(out.conversationState.currentMessage.userInputMessage.content).not.toContain(
      "<max_thinking_length>"
    );
    expect(out.thinking).toBeUndefined();
    expect(out.additionalModelRequestFields?.thinking).toEqual({ type: "adaptive", display: "summarized" });
    expect(out.additionalModelRequestFields?.output_config?.effort).toBe("high");
    // sonnet-4.5 has no max_tokens in its schema → field omitted.
    expect(out.additionalModelRequestFields?.max_tokens).toBeUndefined();
    expect(out.inferenceConfig).toBeUndefined();
  });

  it("maps client reasoning_effort to nested output_config.effort + max_tokens", () => {
    const out = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.KIRO,
      "claude-opus-4-8-thinking",
      { messages: [{ role: "user", content: "hi" }], reasoning_effort: "max" },
      true,
      null,
      "kiro"
    );
    expect(out.additionalModelRequestFields?.output_config?.effort).toBe("max");
    expect(out.additionalModelRequestFields?.max_tokens).toBe(128000);
  });

  it("maps output_config.effort high through to the nested Kiro payload", () => {
    const out = C2K({
      output_config: { effort: "high" },
      messages: [{ role: "user", content: "think with adaptive effort" }],
    });

    // Effort rides nested output_config (not a tag, not top-level).
    expect(out.additionalModelRequestFields?.output_config?.effort).toBe("high");
    expect(out.output_config).toBeUndefined();
    expect(out.conversationState.currentMessage.userInputMessage.content).not.toContain(
      "<max_thinking_length>"
    );
  });
});

describe("Kiro → Claude (direct route, OpenAI-shaped chunks from executor)", () => {
  // KiroExecutor emits chat.completion.chunk objects; translateResponse must
  // convert them to Claude SSE events.
  const R = (chunk, state) => translateResponse(FORMATS.KIRO, FORMATS.CLAUDE, chunk, state);

  it("first text chunk emits message_start + content_block_start + text_delta", () => {
    const state = {};
    const events = R(
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        model: "claude-sonnet-4.5",
        choices: [{ index: 0, delta: { role: "assistant", content: "Hi" }, finish_reason: null }],
      },
      state
    );
    const types = events.map((e) => e.type);
    expect(types).toContain("message_start");
    expect(types).toContain("content_block_start");
    expect(types).toContain("content_block_delta");
    const delta = events.find((e) => e.type === "content_block_delta");
    expect(delta.delta).toEqual({ type: "text_delta", text: "Hi" });
  });

  it("finish chunk emits message_delta + message_stop with stop_reason", () => {
    const state = {};
    R(
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        model: "m",
        choices: [{ index: 0, delta: { content: "x" }, finish_reason: null }],
      },
      state
    );
    const events = R(
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        model: "m",
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 5, completion_tokens: 3 },
      },
      state
    );
    const md = events.find((e) => e.type === "message_delta");
    expect(md.delta.stop_reason).toBe("end_turn");
    expect(md.usage).toEqual({ input_tokens: 5, output_tokens: 3 });
    expect(events.some((e) => e.type === "message_stop")).toBe(true);
  });

  it("reasoning_content maps to a thinking block", () => {
    const state = {};
    const events = R(
      {
        id: "chatcmpl-1",
        object: "chat.completion.chunk",
        model: "m",
        choices: [{ index: 0, delta: { reasoning_content: "pondering" }, finish_reason: null }],
      },
      state
    );
    const start = events.find((e) => e.type === "content_block_start");
    expect(start.content_block.type).toBe("thinking");
    const delta = events.find((e) => e.type === "content_block_delta");
    expect(delta.delta).toEqual({ type: "thinking_delta", thinking: "pondering" });
  });

  it("tool_calls map to a tool_use block with buffered input_json_delta", () => {
    const state = {};
    R(
      {
        id: "c", object: "chat.completion.chunk", model: "m",
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: "tu1", type: "function", function: { name: "search", arguments: "" } }] }, finish_reason: null }],
      },
      state
    );
    R(
      {
        id: "c", object: "chat.completion.chunk", model: "m",
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":"x"}' } }] }, finish_reason: null }],
      },
      state
    );
    const events = R(
      {
        id: "c", object: "chat.completion.chunk", model: "m",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      },
      state
    );
    const jsonDelta = events.find(
      (e) => e.type === "content_block_delta" && e.delta.type === "input_json_delta"
    );
    expect(jsonDelta.index).toBeDefined();
    expect(jsonDelta.delta.partial_json).toBe('{"q":"x"}');
    const md = events.find((e) => e.type === "message_delta");
    expect(md.delta.stop_reason).toBe("tool_use");
  });
});
