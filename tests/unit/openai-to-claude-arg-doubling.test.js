import { describe, expect, it } from "vitest";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

function createState() {
  return { toolCalls: new Map(), nextBlockIndex: 0 };
}

function getInputJsonDeltas(events) {
  return events
    .filter((event) => event.type === "content_block_delta" && event.delta?.type === "input_json_delta")
    .map((event) => event.delta.partial_json);
}

const ARGS = JSON.stringify({ file_path: "F:/repo/file.js" });

function startToolCall(state) {
  openaiToClaudeResponse({
    id: "chatcmpl-test-dup",
    model: "test-model",
    choices: [{ delta: { tool_calls: [{ index: 0, id: "toolu_dup", function: { name: "Read" } }] } }],
  }, state);
}

describe("openaiToClaudeResponse arg doubling guards", () => {
  it("replaces instead of appending when a provider streams cumulative args", () => {
    const state = createState();
    startToolCall(state);

    openaiToClaudeResponse({
      id: "chatcmpl-test-dup",
      model: "test-model",
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ARGS.slice(0, 10) } }] } }],
    }, state);
    // Cumulative provider: second chunk restates the full string so far
    openaiToClaudeResponse({
      id: "chatcmpl-test-dup",
      model: "test-model",
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ARGS } }] } }],
    }, state);

    const events = openaiToClaudeResponse({
      id: "chatcmpl-test-dup",
      model: "test-model",
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
    }, state);

    expect(JSON.parse(getInputJsonDeltas(events)[0])).toEqual({ file_path: "F:/repo/file.js" });
  });

  it("emits buffered args only once when finish_reason repeats on a trailing chunk", () => {
    const state = createState();
    startToolCall(state);

    openaiToClaudeResponse({
      id: "chatcmpl-test-dup",
      model: "test-model",
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ARGS } }] } }],
    }, state);

    const first = openaiToClaudeResponse({
      id: "chatcmpl-test-dup",
      model: "test-model",
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
    }, state);
    const second = openaiToClaudeResponse({
      id: "chatcmpl-test-dup",
      model: "test-model",
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }, state);

    expect(getInputJsonDeltas(first)).toHaveLength(1);
    expect(getInputJsonDeltas(second ?? [])).toHaveLength(0);
  });

  it("repairs args that arrive as the same JSON doubled back-to-back", () => {
    const state = createState();
    startToolCall(state);

    // Doubled string injected as two non-prefix chunks (bypasses the
    // cumulative guard) — the halving repair in sanitizeToolArgs catches it.
    openaiToClaudeResponse({
      id: "chatcmpl-test-dup",
      model: "test-model",
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ARGS + ARGS.slice(0, 5) } }] } }],
    }, state);
    openaiToClaudeResponse({
      id: "chatcmpl-test-dup",
      model: "test-model",
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ARGS.slice(5) } }] } }],
    }, state);

    const events = openaiToClaudeResponse({
      id: "chatcmpl-test-dup",
      model: "test-model",
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
    }, state);

    expect(JSON.parse(getInputJsonDeltas(events)[0])).toEqual({ file_path: "F:/repo/file.js" });
  });
});
