import { describe, expect, it } from "vitest";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

function createState() {
  return { toolCalls: new Map(), nextBlockIndex: 0 };
}

function getInputJsonDelta(events) {
  return events?.find(
    (event) => event.type === "content_block_delta" && event.delta?.type === "input_json_delta"
  )?.delta.partial_json;
}

describe("openaiToClaudeResponse tool argument deduplication & repair", () => {
  it("deduplicates exact repeated arguments sent on finish_reason chunk (ClinePass / GLM issue)", () => {
    const state = createState();
    const argStr = JSON.stringify({ query: "github trending repos september 2026" });

    // Chunk 1: open tool call
    openaiToClaudeResponse({
      id: "chatcmpl-test-repeat",
      model: "cline-pass/glm-5.2",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "call_websearch", function: { name: "WebSearch" } }] } }],
    }, state);

    // Chunk 2: stream arguments
    openaiToClaudeResponse({
      id: "chatcmpl-test-repeat",
      model: "cline-pass/glm-5.2",
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: argStr } }] } }],
    }, state);

    // Chunk 3: upstream repeats full tool_calls on finish_reason
    const events = openaiToClaudeResponse({
      id: "chatcmpl-test-repeat",
      model: "cline-pass/glm-5.2",
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { arguments: argStr } }] },
        finish_reason: "tool_calls",
      }],
    }, state);

    const delta = getInputJsonDelta(events);
    expect(delta).toBe(argStr);
    expect(JSON.parse(delta)).toEqual({ query: "github trending repos september 2026" });
  });

  it("repairs duplicated concatenated JSON when upstream streams doubled JSON", () => {
    const state = createState();
    const half = JSON.stringify({ query: "github trending repos september 2026" });
    const doubled = half + half;

    openaiToClaudeResponse({
      id: "chatcmpl-test-doubled",
      model: "cline-pass/glm-5.2",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "call_websearch_2", function: { name: "WebSearch" } }] } }],
    }, state);

    // Suppose upstream emitted the doubled string directly in a chunk
    const events = openaiToClaudeResponse({
      id: "chatcmpl-test-doubled",
      model: "cline-pass/glm-5.2",
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { arguments: doubled } }] },
        finish_reason: "tool_calls",
      }],
    }, state);

    const delta = getInputJsonDelta(events);
    expect(delta).toBe(half);
    expect(JSON.parse(delta)).toEqual({ query: "github trending repos september 2026" });
  });

  it("handles cumulative streaming snapshots without duplication", () => {
    const state = createState();

    openaiToClaudeResponse({
      id: "chatcmpl-test-cumulative",
      model: "cline-pass/glm-5.2",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "call_cum", function: { name: "WebSearch" } }] } }],
    }, state);

    // Snapshot 1
    openaiToClaudeResponse({
      id: "chatcmpl-test-cumulative",
      model: "cline-pass/glm-5.2",
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"query":' } }] } }],
    }, state);

    // Snapshot 2: cumulative (starts with snapshot 1)
    const events = openaiToClaudeResponse({
      id: "chatcmpl-test-cumulative",
      model: "cline-pass/glm-5.2",
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { arguments: '{"query":"hello world"}' } }] },
        finish_reason: "tool_calls",
      }],
    }, state);

    const delta = getInputJsonDelta(events);
    expect(delta).toBe('{"query":"hello world"}');
    expect(JSON.parse(delta)).toEqual({ query: "hello world" });
  });

  it("preserves standard streaming diff chunks correctly", () => {
    const state = createState();

    openaiToClaudeResponse({
      id: "chatcmpl-test-diff",
      model: "cline-pass/glm-5.2",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "call_diff", function: { name: "WebSearch" } }] } }],
    }, state);

    // Diff 1
    openaiToClaudeResponse({
      id: "chatcmpl-test-diff",
      model: "cline-pass/glm-5.2",
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"query":' } }] } }],
    }, state);

    // Diff 2
    openaiToClaudeResponse({
      id: "chatcmpl-test-diff",
      model: "cline-pass/glm-5.2",
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"normal stream"}' } }] } }],
    }, state);

    const events = openaiToClaudeResponse({
      id: "chatcmpl-test-diff",
      model: "cline-pass/glm-5.2",
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
    }, state);

    const delta = getInputJsonDelta(events);
    expect(delta).toBe('{"query":"normal stream"}');
    expect(JSON.parse(delta)).toEqual({ query: "normal stream" });
  });

  it("does not re-emit tool argument delta when multiple finish chunks arrive", () => {
    const state = createState();
    const argStr = JSON.stringify({ prompt: "test prompt", url: "https://example.com" });

    // Chunk 1: open tool call
    openaiToClaudeResponse({
      id: "chatcmpl-multi-finish",
      model: "cline-pass/glm-5.2",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "call_webfetch", function: { name: "WebFetch" } }] } }],
    }, state);

    // Chunk 2: stream arguments
    openaiToClaudeResponse({
      id: "chatcmpl-multi-finish",
      model: "cline-pass/glm-5.2",
      choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: argStr } }] } }],
    }, state);

    // Chunk 3: first finish chunk (e.g. finish_reason: "tool_calls")
    const events1 = openaiToClaudeResponse({
      id: "chatcmpl-multi-finish",
      model: "cline-pass/glm-5.2",
      choices: [{ delta: {}, finish_reason: "tool_calls" }],
    }, state);

    // Chunk 4: second finish chunk (e.g. finish_reason: "stop" with usage)
    const events2 = openaiToClaudeResponse({
      id: "chatcmpl-multi-finish",
      model: "cline-pass/glm-5.2",
      choices: [{ delta: {}, finish_reason: "stop" }],
    }, state);

    const delta1 = getInputJsonDelta(events1);
    expect(delta1).toBe(argStr);

    const delta2 = getInputJsonDelta(events2);
    expect(delta2).toBeUndefined();
  });

  it("forwards final usage from a later finish chunk via usage-only message_delta", () => {
    const state = createState();

    openaiToClaudeResponse({
      id: "chatcmpl-late-usage",
      model: "cline-pass/glm-5.2",
      choices: [{ delta: { content: "answer" } }],
    }, state);

    // First finish chunk: no usage
    const events1 = openaiToClaudeResponse({
      id: "chatcmpl-late-usage",
      model: "cline-pass/glm-5.2",
      choices: [{ delta: {}, finish_reason: "stop" }],
    }, state);
    expect(events1.some(e => e.type === "message_stop")).toBe(true);

    // Later finish chunk: carries final usage
    const events2 = openaiToClaudeResponse({
      id: "chatcmpl-late-usage",
      model: "cline-pass/glm-5.2",
      choices: [{ delta: {}, finish_reason: "stop" }],
      usage: { prompt_tokens: 100, completion_tokens: 42 },
    }, state);

    const usageDelta = events2?.find(e => e.type === "message_delta");
    expect(usageDelta).toBeTruthy();
    expect(usageDelta.usage).toEqual({ input_tokens: 100, output_tokens: 42 });
    // No duplicate message_stop, no re-opened content blocks
    expect(events2.some(e => e.type === "message_stop")).toBe(false);
    expect(events2.some(e => e.type === "content_block_start")).toBe(false);
  });
});
