import { describe, expect, it } from "vitest";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

function createState() {
  return { toolCalls: new Map(), nextBlockIndex: 0 };
}

function getInputJsonDelta(events) {
  return events.find((event) => event.type === "content_block_delta" && event.delta?.type === "input_json_delta")?.delta.partial_json;
}

describe("openaiToClaudeResponse tool argument sanitization", () => {
  it("drops invalid Read pages and clamps numeric bounds", () => {
    const state = createState();

    openaiToClaudeResponse({
      id: "chatcmpl-test-read",
      model: "test-model",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "toolu_read", function: { name: "Read" } }] } }],
    }, state);

    const events = openaiToClaudeResponse({
      id: "chatcmpl-test-read",
      model: "test-model",
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ file_path: "F:/repo/file.js", offset: -5, limit: 999999999, pages: "" }) } }] },
        finish_reason: "tool_calls",
      }],
    }, state);

    expect(JSON.parse(getInputJsonDelta(events))).toEqual({
      file_path: "F:/repo/file.js",
      offset: 0,
      limit: 2000,
    });
  });

  it("does not re-emit tool blocks when finish_reason repeats (OpenRouter terminal chunk)", () => {
    const state = createState();
    const events = [];
    const collect = (chunk) => {
      const out = openaiToClaudeResponse(chunk, state);
      if (out) events.push(...out);
    };

    const args = [
      { file_path: "/a.js" },
      { command: "ls -la", description: "x".repeat(2000) },
      { pattern: "foo.*bar" },
    ];

    // 3 parallel tool calls, ids/names on first delta of each index
    collect({ id: "gen-123", model: "glm", choices: [{ delta: { tool_calls: [
      { index: 0, id: "call_a", function: { name: "Read", arguments: "" } },
      { index: 1, id: "call_b", function: { name: "Bash", arguments: "" } },
      { index: 2, id: "call_c", function: { name: "Grep", arguments: "" } },
    ] } }] });

    // arguments sliced across many deltas (GLM repeats id on every fragment)
    for (let i = 0; i < 3; i++) {
      const json = JSON.stringify(args[i]);
      for (let pos = 0; pos < json.length; pos += 7) {
        collect({ id: "gen-123", model: "glm", choices: [{ delta: { tool_calls: [
          { index: i, id: `call_${"abc"[i]}`, function: { arguments: json.slice(pos, pos + 7) } },
        ] } }] });
      }
    }

    // upstream finish chunk…
    collect({ id: "gen-123", model: "glm", choices: [{ delta: {}, finish_reason: "tool_calls" }] });
    // …then the aggregator's terminal usage chunk repeating finish_reason
    collect({ id: "gen-123", model: "glm", choices: [{ delta: {}, finish_reason: "tool_calls" }], usage: { prompt_tokens: 10, completion_tokens: 5 } });

    const starts = events.filter((e) => e.type === "content_block_start" && e.content_block.type === "tool_use");
    expect(starts.map((e) => e.content_block.id)).toEqual(["call_a", "call_b", "call_c"]);
    expect(new Set(starts.map((e) => e.content_block.id)).size).toBe(3);

    const toolIndexes = starts.map((e) => e.index);
    const argDeltas = events.filter((e) => e.type === "content_block_delta" && e.delta?.type === "input_json_delta");
    expect(argDeltas.map((e) => e.index)).toEqual(toolIndexes);
    expect(argDeltas.map((e) => JSON.parse(e.delta.partial_json))).toEqual(args);

    const stops = events.filter((e) => e.type === "content_block_stop" && toolIndexes.includes(e.index));
    expect(stops.map((e) => e.index)).toEqual(toolIndexes);

    expect(events.filter((e) => e.type === "message_delta")).toHaveLength(1);
    expect(events.filter((e) => e.type === "message_stop")).toHaveLength(1);
  });

  it("still emits finish when a pivot's first hop already set finishReasonSent (codex chain)", () => {
    // openai-responses→openai (codex) sets state.finishReasonSent=true when it
    // emits its finish chunk into this translator via the shared pivot state.
    const state = { ...createState(), finishReasonSent: true };
    const events = [];
    const collect = (chunk) => {
      const out = openaiToClaudeResponse(chunk, state);
      if (out) events.push(...out);
    };

    collect({ id: "resp-1", model: "gpt-5.6-sol", choices: [{ delta: { content: "oi" } }] });
    collect({ id: "resp-1", model: "gpt-5.6-sol", choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2 } });
    // aggregator repeat must still be deduped
    collect({ id: "resp-1", model: "gpt-5.6-sol", choices: [{ delta: {}, finish_reason: "stop" }] });

    expect(events.filter((e) => e.type === "message_delta")).toHaveLength(1);
    expect(events.filter((e) => e.type === "message_stop")).toHaveLength(1);
  });

  it("emits message_stop once when finish_reason repeats without tool calls", () => {
    const state = createState();
    const events = [];
    const collect = (chunk) => {
      const out = openaiToClaudeResponse(chunk, state);
      if (out) events.push(...out);
    };

    collect({ id: "gen-9", model: "glm", choices: [{ delta: { content: "hello" } }] });
    collect({ id: "gen-9", model: "glm", choices: [{ delta: {}, finish_reason: "stop" }] });
    collect({ id: "gen-9", model: "glm", choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 1 } });

    expect(events.filter((e) => e.type === "message_delta")).toHaveLength(1);
    expect(events.filter((e) => e.type === "message_stop")).toHaveLength(1);
    expect(events.filter((e) => e.type === "content_block_stop")).toHaveLength(1);
  });

  it("keeps valid PDF pages", () => {
    const state = createState();

    openaiToClaudeResponse({
      id: "chatcmpl-test-pdf",
      model: "test-model",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "toolu_pdf", function: { name: "proxy_Read" } }] } }],
    }, state);

    const events = openaiToClaudeResponse({
      id: "chatcmpl-test-pdf",
      model: "test-model",
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ file_path: "F:/repo/doc.pdf", pages: "1-3" }) } }] },
        finish_reason: "tool_calls",
      }],
    }, state);

    expect(JSON.parse(getInputJsonDelta(events))).toEqual({
      file_path: "F:/repo/doc.pdf",
      pages: "1-3",
    });
  });
});
