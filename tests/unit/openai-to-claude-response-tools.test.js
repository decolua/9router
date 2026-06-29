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

  it("handles GLM 5.2 deferred tool name arriving after id in separate chunk", () => {
    const state = createState();

    // GLM 5.2 sends tool call ID without name in first chunk
    const chunk1 = {
      id: "chatcmpl-test-glm",
      model: "glm-5.2",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "call_abc123" }] } }],
    };
    const r1 = openaiToClaudeResponse(chunk1, state);

    // Should NOT emit content_block_start yet (name is pending)
    const blockStart1 = r1?.find(e => e.type === "content_block_start");
    expect(blockStart1).toBeUndefined();

    // Second chunk: name arrives (GLM 5.2 pattern)
    const chunk2 = {
      id: "chatcmpl-test-glm",
      model: "glm-5.2",
      choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "Read" } }] } }],
    };
    const r2 = openaiToClaudeResponse(chunk2, state);

    // Should emit content_block_start with the name now
    const blockStart2 = r2?.find(e => e.type === "content_block_start" && e.content_block?.name === "Read");
    expect(blockStart2).toBeDefined();
    expect(blockStart2.content_block.id).toBe("call_abc123");

    // Third chunk: arguments arrive
    const chunk3 = {
      id: "chatcmpl-test-glm",
      model: "glm-5.2",
      choices: [{
        delta: { tool_calls: [{ index: 0, function: { arguments: JSON.stringify({ file_path: "/tmp/test.js" }) } }] },
        finish_reason: "tool_calls",
      }],
    };
    const r3 = openaiToClaudeResponse(chunk3, state);

    const inputDelta = getInputJsonDelta(r3);
    expect(inputDelta).toBeDefined();
    expect(JSON.parse(inputDelta)).toEqual({ file_path: "/tmp/test.js" });
  });

  it("handles GLM 5.2 tool name arriving in finish chunk", () => {
    const state = createState();

    // GLM 5.2: id only (no name)
    openaiToClaudeResponse({
      id: "chatcmpl-test",
      model: "glm-5.2",
      choices: [{ delta: { tool_calls: [{ index: 0, id: "call_xyz" }] } }],
    }, state);

    // Name + arguments + finish in same chunk (GLM 5.2 edge case)
    const events = openaiToClaudeResponse({
      id: "chatcmpl-test",
      model: "glm-5.2",
      choices: [{
        delta: {
          tool_calls: [
            { index: 0, function: { name: "Read", arguments: JSON.stringify({ file_path: "/tmp/test.js" }) } }
          ]
        },
        finish_reason: "tool_calls",
      }],
    }, state);

    // content_block_start should be emitted (deferred name flushed)
    const blockStart = events?.find(e => e.type === "content_block_start" && e.content_block?.name === "Read");
    expect(blockStart).toBeDefined();
    expect(blockStart.content_block.id).toBe("call_xyz");

    const inputDelta = getInputJsonDelta(events);
    expect(inputDelta).toBeDefined();
    expect(JSON.parse(inputDelta)).toEqual({ file_path: "/tmp/test.js" });
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
