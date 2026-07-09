// Claude → Kiro (direct route) request translation + Kiro → Claude response.
// Verifies the direct claude:kiro / kiro:claude routes added to bypass the
// OpenAI pivot, and that the "Improperly formed request" 400-guards survive.
import { describe, it, expect } from "vitest";
import "./registerAll.js";
import { translateRequest, translateResponse } from "../../open-sse/translator/index.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const C2K = (body, credentials = null) =>
  translateRequest(FORMATS.CLAUDE, FORMATS.KIRO, "claude-sonnet-4.5", body, true, credentials, "kiro");

describe("Claude → Kiro (direct route)", () => {
  it("produces a Kiro conversationState payload", () => {
    const out = C2K({ messages: [{ role: "user", content: "hello" }] });
    expect(out.conversationState).toBeTruthy();
    expect(out.conversationState.currentMessage.userInputMessage.content).toContain("hello");
  });

  it("keeps the same conversationId for the same client session header", () => {
    const credentials = {
      rawHeaders: { "x-session-id": "client-session-123" },
      connectionId: "conn-a",
    };
    const body = { messages: [{ role: "user", content: "hello" }] };

    const first = C2K(body, credentials);
    const second = C2K(body, credentials);

    expect(first.conversationState.conversationId).toBe("client-session-123");
    expect(second.conversationState.conversationId).toBe("client-session-123");
  });

  it("uses different conversationIds for different client session headers", () => {
    const body = { messages: [{ role: "user", content: "hello" }] };

    const first = C2K(body, {
      rawHeaders: { "x-session-id": "client-session-a" },
      connectionId: "conn-a",
    });
    const second = C2K(body, {
      rawHeaders: { "x-session-id": "client-session-b" },
      connectionId: "conn-a",
    });

    expect(first.conversationState.conversationId).toBe("client-session-a");
    expect(second.conversationState.conversationId).toBe("client-session-b");
  });

  it("keeps the same Kiro conversationId for the same Slack thread despite volatile request ids", () => {
    const metadataAnchor = {
      metadata: { slack_thread: "C0130M8P4HK:1783546858.709689" },
      messages: [{ role: "user", content: "summarize this thread" }],
    };
    const systemPermalink = {
      system:
        "Slack thread: https://example.slack.com/archives/C0130M8P4HK/p1783546858709689?thread_ts=1783546858%2E709689&cid=C0130M8P4HK",
      messages: [{ role: "user", content: "summarize this thread" }],
    };
    const userSlashAnchor = {
      messages: [{ role: "user", content: "Follow up on C0130M8P4HK/1783546858.709689" }],
    };

    const first = C2K(metadataAnchor, {
      rawHeaders: { "x-client-request-id": "req-a" },
      connectionId: "kiro-conn",
    });
    const second = C2K(systemPermalink, {
      rawHeaders: { "x-client-request-id": "req-b" },
      connectionId: "kiro-conn",
    });
    const third = C2K(userSlashAnchor, {
      rawHeaders: { "x-client-request-id": "req-c" },
      connectionId: "kiro-conn",
    });

    expect(first.conversationState.conversationId).toBe(second.conversationState.conversationId);
    expect(second.conversationState.conversationId).toBe(third.conversationState.conversationId);
  });

  it("uses different Kiro conversationIds for different Slack thread anchors", () => {
    const first = C2K({
      metadata: { slack_thread: "C0130M8P4HK:1783546858.709689" },
      messages: [{ role: "user", content: "summarize this thread" }],
    });
    const second = C2K({
      metadata: { slack_thread: "C0130M8P4HK:1783546859.709689" },
      messages: [{ role: "user", content: "summarize this thread" }],
    });

    expect(first.conversationState.conversationId).not.toBe(second.conversationState.conversationId);
  });

  it.each([
    ["prompt_cache_key", "explicit-cache-key"],
    ["session_id", "explicit-session-id"],
    ["conversation_id", "explicit-conversation-id"],
  ])("respects explicit %s and does not replace it with a Kiro prompt cache key", (key, value) => {
    const out = C2K(
      {
        [key]: value,
        metadata: { slack_thread: "C0130M8P4HK:1783546858.709689" },
        messages: [{ role: "user", content: "summarize this thread" }],
      },
      {
        rawHeaders: { "x-client-request-id": "volatile-request-id" },
        connectionId: "kiro-conn",
      }
    );

    expect(out.conversationState.conversationId).toBe(value);
  });

  it("keeps non-Slack fallback conversationIds deterministic across volatile request ids", () => {
    const body = {
      metadata: { user_id: "slack-user-without-thread-anchor" },
      messages: [{ role: "user", content: "plain non Slack request" }],
    };
    const changedUserContent = {
      metadata: { user_id: "slack-user-without-thread-anchor" },
      messages: [{ role: "user", content: "different plain non Slack request" }],
    };

    const first = C2K(body, {
      rawHeaders: { "x-client-request-id": "req-a" },
      connectionId: "kiro-conn",
    });
    const second = C2K(body, {
      rawHeaders: { "x-client-request-id": "req-b" },
      connectionId: "kiro-conn",
    });
    const different = C2K(changedUserContent, {
      rawHeaders: { "x-client-request-id": "req-c" },
      connectionId: "kiro-conn",
    });

    expect(first.conversationState.conversationId).toBe(second.conversationState.conversationId);
    expect(first.conversationState.conversationId).not.toBe(different.conversationState.conversationId);
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

  it("injects thinking_mode tag when model implies thinking", () => {
    const out = translateRequest(
      FORMATS.CLAUDE,
      FORMATS.KIRO,
      "claude-sonnet-4.5-thinking",
      { messages: [{ role: "user", content: "hi" }] },
      true,
      null,
      "kiro"
    );
    expect(out.conversationState.currentMessage.userInputMessage.content).toContain(
      "<thinking_mode>enabled</thinking_mode>"
    );
  });

  it("maps output_config.effort high to Kiro max_thinking_length 24576", () => {
    const out = C2K({
      output_config: { effort: "high" },
      messages: [{ role: "user", content: "think with adaptive effort" }],
    });

    expect(out.conversationState.currentMessage.userInputMessage.content).toContain(
      "<max_thinking_length>24576</max_thinking_length>"
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
