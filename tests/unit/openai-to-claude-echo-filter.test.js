import { describe, expect, it } from "vitest";
import { openaiToClaudeResponse } from "../../open-sse/translator/response/openai-to-claude.js";

function createState() {
  return { toolCalls: new Map(), nextBlockIndex: 0 };
}

function textChunk(text, finish) {
  return {
    id: "chatcmpl-test-echo",
    model: "test-model",
    choices: [{ delta: text === null ? {} : { content: text }, ...(finish ? { finish_reason: "stop" } : {}) }],
  };
}

function collectText(state, chunks) {
  let out = "";
  for (const c of chunks) {
    const events = openaiToClaudeResponse(c, state) || [];
    for (const e of events) {
      if (e.type === "content_block_delta" && e.delta?.type === "text_delta") out += e.delta.text;
    }
  }
  return out;
}

describe("openaiToClaudeResponse harness-XML echo filter", () => {
  it("drops an echoed instructions block contained in one chunk", () => {
    const out = collectText(createState(), [
      textChunk("before <instructions>echoed harness text</instructions> after"),
      textChunk(null, true),
    ]);
    expect(out).toBe("before  after");
  });

  it("drops a system-reminder block split across chunks", () => {
    const out = collectText(createState(), [
      textChunk("keep <system-rem"),
      textChunk("inder>secret nudge</system-"),
      textChunk("reminder>also keep"),
      textChunk(null, true),
    ]);
    expect(out).toBe("keep also keep");
  });

  it("passes through angle brackets that are not harness tags", () => {
    const out = collectText(createState(), [
      textChunk("a < b and <instructional> stays "),
      textChunk("<generic>tag</generic>"),
      textChunk(null, true),
    ]);
    expect(out).toBe("a < b and <instructional> stays <generic>tag</generic>");
  });

  it("flushes a held non-tag prefix at finish and drops an unclosed block", () => {
    const heldPrefix = collectText(createState(), [
      textChunk("ends with <instru"),
      textChunk(null, true),
    ]);
    expect(heldPrefix).toBe("ends with <instru");

    const unclosed = collectText(createState(), [
      textChunk("real text <task-notification>never closed"),
      textChunk(null, true),
    ]);
    expect(unclosed).toBe("real text ");
  });
});
