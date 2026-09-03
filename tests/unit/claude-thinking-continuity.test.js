import { describe, expect, it } from "vitest";

import {
  CLAUDE_THINKING_ENVELOPE_PREFIX,
  MAX_CLAUDE_THINKING_ENVELOPE_LENGTH,
  decodeClaudeThinkingEnvelope,
  encodeClaudeThinkingEnvelope,
} from "../../open-sse/translator/concerns/claudeThinking.js";
import { FORMATS } from "../../open-sse/translator/formats.js";
import { initState, translateRequest, translateResponse } from "../../open-sse/translator/index.js";

function translateClaudeEvents(events) {
  const state = initState(FORMATS.OPENAI_RESPONSES);
  return events.flatMap((event) =>
    translateResponse(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, event, state));
}

function completedOutput(events) {
  return events
    .filter(({ event }) => event === "response.output_item.done")
    .map(({ data }) => data.item);
}

function toolTurnEvents(thinkingEvents, calls = [
  { index: 1, id: "call_a", name: "shell_command", arguments: "{\"cmd\":\"pwd\"}" },
]) {
  const events = [
    {
      type: "message_start",
      message: {
        id: "msg_test",
        model: "claude-fable-5",
        usage: { input_tokens: 10, output_tokens: 0 },
      },
    },
    ...thinkingEvents,
  ];
  for (const call of calls) {
    events.push(
      {
        type: "content_block_start",
        index: call.index,
        content_block: { type: "tool_use", id: call.id, name: call.name, input: {} },
      },
      {
        type: "content_block_delta",
        index: call.index,
        delta: { type: "input_json_delta", partial_json: call.arguments },
      },
      { type: "content_block_stop", index: call.index },
    );
  }
  events.push(
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 7 } },
    { type: "message_stop" },
  );
  return events;
}

function translateResponsesHistory(model, input) {
  return translateRequest(
    FORMATS.OPENAI_RESPONSES,
    FORMATS.CLAUDE,
    model,
    { input, reasoning: { effort: "max" } },
    true,
    {},
    "github",
  );
}

describe("Claude thinking continuity envelope", () => {
  const model = "claude-fable-5";
  const blocks = [
    { type: "thinking", thinking: "", signature: "sig-exact" },
    { type: "redacted_thinking", data: "redacted-exact" },
  ];

  it("round-trips omitted and redacted thinking byte-exact", () => {
    const encoded = encodeClaudeThinkingEnvelope(model, blocks);

    expect(encoded).toMatch(/^9router:claude-thinking:v1:/);
    expect(decodeClaudeThinkingEnvelope(encoded, model)).toEqual(blocks);
  });

  it("rejects foreign, malformed, oversized, and cross-model envelopes", () => {
    const encoded = encodeClaudeThinkingEnvelope(model, blocks);

    expect(decodeClaudeThinkingEnvelope("foreign:" + encoded, model)).toBeNull();
    expect(decodeClaudeThinkingEnvelope(`${CLAUDE_THINKING_ENVELOPE_PREFIX}%%%`, model)).toBeNull();
    expect(decodeClaudeThinkingEnvelope(encoded, "claude-opus-5")).toBeNull();
    expect(decodeClaudeThinkingEnvelope(
      CLAUDE_THINKING_ENVELOPE_PREFIX + "A".repeat(MAX_CLAUDE_THINKING_ENVELOPE_LENGTH + 1),
      model,
    )).toBeNull();
  });

  it("rejects invalid blocks instead of preserving a partial sequence", () => {
    expect(encodeClaudeThinkingEnvelope(model, [
      blocks[0],
      { type: "thinking", thinking: "missing signature" },
    ])).toBeNull();
    expect(encodeClaudeThinkingEnvelope(model, [
      { type: "redacted_thinking", data: 42 },
    ])).toBeNull();

    const invalidPayload = Buffer.from(JSON.stringify({
      model,
      blocks: [{ type: "thinking", thinking: "x", signature: "sig", extra: "drop-me" }],
    }), "utf8").toString("base64url");
    expect(decodeClaudeThinkingEnvelope(
      CLAUDE_THINKING_ENVELOPE_PREFIX + invalidPayload,
      model,
    )).toBeNull();
  });
});

describe("Claude stream thinking continuity", () => {
  it("puts omitted thinking and its signature on the Responses reasoning item", () => {
    const events = translateClaudeEvents(toolTurnEvents([
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-exact" } },
      { type: "content_block_stop", index: 0 },
    ]));
    const output = completedOutput(events);

    expect(output.map((item) => item.type)).toEqual(["reasoning", "function_call"]);
    expect(decodeClaudeThinkingEnvelope(
      output[0].encrypted_content,
      "claude-fable-5",
    )).toEqual([{ type: "thinking", thinking: "", signature: "sig-exact" }]);
  });

  it("preserves a redacted thinking block without exposing its data as summary text", () => {
    const events = translateClaudeEvents(toolTurnEvents([
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "redacted_thinking", data: "redacted-exact" },
      },
      { type: "content_block_stop", index: 0 },
    ]));
    const output = completedOutput(events);

    expect(output[0].summary).toEqual([{ type: "summary_text", text: "" }]);
    expect(decodeClaudeThinkingEnvelope(
      output[0].encrypted_content,
      "claude-fable-5",
    )).toEqual([{ type: "redacted_thinking", data: "redacted-exact" }]);
  });

  it("keeps one reasoning item before parallel tool calls", () => {
    const events = translateClaudeEvents(toolTurnEvents([
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "plan" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: " more" } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-parallel" } },
      { type: "content_block_stop", index: 0 },
    ], [
      { index: 1, id: "call_a", name: "shell_command", arguments: "{\"cmd\":\"pwd\"}" },
      { index: 2, id: "call_b", name: "apply_patch", arguments: "{\"patch\":\"x\"}" },
    ]));
    const output = completedOutput(events);

    expect(output.map((item) => item.type)).toEqual([
      "reasoning",
      "function_call",
      "function_call",
    ]);
    expect(output.slice(1).map((item) => item.call_id)).toEqual(["call_a", "call_b"]);
    expect(decodeClaudeThinkingEnvelope(
      output[0].encrypted_content,
      "claude-fable-5",
    )).toEqual([{ type: "thinking", thinking: "plan more", signature: "sig-parallel" }]);
  });
});

describe("Responses history to Claude thinking continuity", () => {
  it("restores exact ordered thinking before parallel tools and pairs their results", () => {
    const output = completedOutput(translateClaudeEvents(toolTurnEvents([
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig-exact" } },
      { type: "content_block_stop", index: 0 },
      {
        type: "content_block_start",
        index: 1,
        content_block: { type: "redacted_thinking", data: "redacted-exact" },
      },
      { type: "content_block_stop", index: 1 },
    ], [
      { index: 2, id: "call_a", name: "shell_command", arguments: "{\"cmd\":\"pwd\"}" },
      { index: 3, id: "call_b", name: "apply_patch", arguments: "{\"patch\":\"x\"}" },
    ])));
    const request = translateResponsesHistory("claude-fable-5", [
      { type: "message", role: "user", content: [{ type: "input_text", text: "work" }] },
      ...output,
      { type: "function_call_output", call_id: "call_a", output: "/tmp" },
      { type: "function_call_output", call_id: "call_b", output: "done" },
    ]);
    const assistantIndex = request.messages.findIndex(({ role }) => role === "assistant");
    const assistant = request.messages[assistantIndex];
    const results = request.messages[assistantIndex + 1];

    expect(assistant.content.slice(0, 2)).toEqual([
      { type: "thinking", thinking: "", signature: "sig-exact" },
      { type: "redacted_thinking", data: "redacted-exact" },
    ]);
    expect(assistant.content.slice(2).map(({ type, id, name }) => ({ type, id, name }))).toEqual([
      { type: "tool_use", id: "call_a", name: "shell_command" },
      { type: "tool_use", id: "call_b", name: "apply_patch" },
    ]);
    expect(results).toMatchObject({
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "call_a", content: "/tmp" },
        { type: "tool_result", tool_use_id: "call_b", content: "done" },
      ],
    });
  });

  it("ignores untrusted envelopes and envelopes without a tool-call owner", () => {
    const trusted = encodeClaudeThinkingEnvelope("claude-fable-5", [
      { type: "thinking", thinking: "private", signature: "sig-exact" },
    ]);
    const rejected = [
      { model: "claude-fable-5", value: "foreign:" + trusted },
      { model: "claude-fable-5", value: `${CLAUDE_THINKING_ENVELOPE_PREFIX}%%%` },
      {
        model: "claude-fable-5",
        value: CLAUDE_THINKING_ENVELOPE_PREFIX + "A".repeat(MAX_CLAUDE_THINKING_ENVELOPE_LENGTH + 1),
      },
      { model: "claude-opus-5", value: trusted },
    ];

    for (const { model, value } of rejected) {
      const request = translateResponsesHistory(model, [
        { type: "reasoning", encrypted_content: value, summary: [] },
        { type: "function_call", call_id: "call_a", name: "shell_command", arguments: "{}" },
      ]);
      const assistant = request.messages.find(({ role }) => role === "assistant");
      expect(assistant.content.some(({ type }) =>
        type === "thinking" || type === "redacted_thinking")).toBe(false);
    }

    const textOnly = translateResponsesHistory("claude-fable-5", [
      { type: "reasoning", encrypted_content: trusted, summary: [] },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "done" }],
      },
      { type: "message", role: "user", content: [{ type: "input_text", text: "next" }] },
    ]);
    expect(textOnly.messages.flatMap(({ content }) => content).some(({ type }) =>
      type === "thinking" || type === "redacted_thinking")).toBe(false);
  });
});
