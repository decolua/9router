// Pure, DOM-free analysis of the request messages stored on a request detail.
// These functions back the "Request" panel of the usage dashboard
// (/dashboard/usage?tab=details) by turning a stored conversation into a
// normalized, render-ready structure plus aggregate statistics.
//
// The module under test is intentionally framework-free: it must never import
// React and must be resilient to the messy shapes providers persist
// (OpenAI string content, OpenAI tool_calls, Anthropic content blocks,
// and unknown non-text blocks).
import { describe, it, expect } from "vitest";
import {
  hasAnalyzableRequestMessages,
  normalizeRequestMessages,
  analyzeRequestMessages,
} from "@/app/(dashboard)/dashboard/usage/components/requestMessageAnalysis.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function detailWith(messages) {
  return { id: "req-1", request: { messages } };
}

const openAiTextDetail = detailWith([
  { role: "system", content: "You are a helpful assistant." },
  { role: "user", content: "What is 2 + 2?" },
  { role: "assistant", content: "4" },
]);

const openAiToolCallsDetail = detailWith([
  { role: "user", content: "Weather in Paris?" },
  {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "call_abc",
        type: "function",
        function: { name: "get_weather", arguments: '{"city":"Paris"}' },
      },
    ],
  },
  { role: "tool", tool_call_id: "call_abc", content: '{"tempC":18}' },
]);

const anthropicBlocksDetail = detailWith([
  { role: "user", content: [{ type: "text", text: "Read the file." }] },
  {
    role: "assistant",
    content: [
      { type: "text", text: "Let me check." },
      { type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "a.txt" } },
    ],
  },
  {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "hello" }],
  },
]);

// ---------------------------------------------------------------------------
// hasAnalyzableRequestMessages
// ---------------------------------------------------------------------------

describe("hasAnalyzableRequestMessages", () => {
  it("returns false for null/undefined/non-object input", () => {
    expect(hasAnalyzableRequestMessages(null)).toBe(false);
    expect(hasAnalyzableRequestMessages(undefined)).toBe(false);
    expect(hasAnalyzableRequestMessages("nope")).toBe(false);
    expect(hasAnalyzableRequestMessages(42)).toBe(false);
  });

  it("returns false when request or messages are missing/empty", () => {
    expect(hasAnalyzableRequestMessages({})).toBe(false);
    expect(hasAnalyzableRequestMessages({ request: {} })).toBe(false);
    expect(hasAnalyzableRequestMessages({ request: { messages: [] } })).toBe(false);
    expect(hasAnalyzableRequestMessages({ request: { messages: "nope" } })).toBe(false);
  });

  it("returns true when at least one message is analyzable", () => {
    expect(hasAnalyzableRequestMessages(openAiTextDetail)).toBe(true);
    expect(hasAnalyzableRequestMessages(openAiToolCallsDetail)).toBe(true);
    expect(hasAnalyzableRequestMessages(anthropicBlocksDetail)).toBe(true);
  });

  it("returns false when every message is empty/blank", () => {
    const blank = detailWith([
      { role: "user", content: "" },
      { role: "assistant", content: "   " },
      { role: "user", content: [] },
      { role: "assistant", content: null },
    ]);
    expect(hasAnalyzableRequestMessages(blank)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// normalizeRequestMessages
// ---------------------------------------------------------------------------

describe("normalizeRequestMessages", () => {
  it("returns an empty array when there is nothing to analyze", () => {
    expect(normalizeRequestMessages(null)).toEqual([]);
    expect(normalizeRequestMessages({})).toEqual([]);
    expect(normalizeRequestMessages({ request: { messages: [] } })).toEqual([]);
  });

  it("normalizes OpenAI string content into a single text block", () => {
    const normalized = normalizeRequestMessages(openAiTextDetail);

    expect(normalized).toHaveLength(3);
    expect(normalized[0]).toEqual({
      index: 0,
      role: "system",
      blocks: [{ type: "text", text: "You are a helpful assistant." }],
    });
    expect(normalized[1]).toEqual({
      index: 1,
      role: "user",
      blocks: [{ type: "text", text: "What is 2 + 2?" }],
    });
  });

  it("normalizes OpenAI tool_calls into tool_call blocks", () => {
    const normalized = normalizeRequestMessages(openAiToolCallsDetail);
    const assistant = normalized[1];

    expect(assistant.role).toBe("assistant");
    expect(assistant.blocks).toContainEqual({
      type: "tool_call",
      id: "call_abc",
      name: "get_weather",
      arguments: '{"city":"Paris"}',
    });

    const tool = normalized[2];
    expect(tool.role).toBe("tool");
    expect(tool.blocks).toContainEqual({
      type: "tool_result",
      toolCallId: "call_abc",
      content: '{"tempC":18}',
    });
  });

  it("normalizes an OpenAI role-tool string result into exactly one tool_result block, not a text block", () => {
    const normalized = normalizeRequestMessages(
      detailWith([{ role: "tool", tool_call_id: "call_abc", content: '{"tempC":18}' }])
    );

    expect(normalized).toHaveLength(1);
    expect(normalized[0].role).toBe("tool");

    const blocks = normalized[0].blocks;
    expect(blocks.filter((b) => b.type === "tool_result")).toHaveLength(1);
    expect(blocks.filter((b) => b.type === "text")).toHaveLength(0);
    expect(blocks).toEqual([
      { type: "tool_result", toolCallId: "call_abc", content: '{"tempC":18}' },
    ]);
  });

  it("normalizes an OpenAI role-tool message whose content is an array into exactly one tool_result block, not generic text blocks", () => {
    const normalized = normalizeRequestMessages(
      detailWith([
        {
          role: "tool",
          tool_call_id: "call_arr",
          content: [{ type: "text", text: '{"tempC":18}' }],
        },
      ])
    );

    expect(normalized).toHaveLength(1);
    expect(normalized[0].role).toBe("tool");

    const blocks = normalized[0].blocks;
    expect(blocks.filter((b) => b.type === "tool_result")).toHaveLength(1);
    expect(blocks.filter((b) => b.type === "text")).toHaveLength(0);
    expect(blocks).toEqual([
      {
        type: "tool_result",
        toolCallId: "call_arr",
        content: [{ type: "text", text: '{"tempC":18}' }],
      },
    ]);
  });

  it("preserves Anthropic tool_use and tool_result blocks with their identity", () => {
    const normalized = normalizeRequestMessages(anthropicBlocksDetail);

    const assistant = normalized[1];
    expect(assistant.blocks).toContainEqual({
      type: "tool_use",
      id: "toolu_1",
      name: "read_file",
      input: { path: "a.txt" },
    });

    const toolResult = normalized[2];
    expect(toolResult.blocks).toContainEqual({
      type: "tool_result",
      toolUseId: "toolu_1",
      content: "hello",
    });
  });

  it("keeps non-text blocks but does not coerce them into text", () => {
    const normalized = normalizeRequestMessages(
      detailWith([
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } },
          ],
        },
      ])
    );

    const blocks = normalized[0].blocks;
    expect(blocks).toContainEqual({ type: "text", text: "look" });

    const image = blocks.find((b) => b.type === "image");
    expect(image).toBeDefined();
    // Non-text blocks stay typed as-is; they must not carry a fabricated `text`.
    expect(image).not.toHaveProperty("text");
  });

  it("assigns a stable, zero-based index matching source order", () => {
    const normalized = normalizeRequestMessages(openAiTextDetail);
    expect(normalized.map((m) => m.index)).toEqual([0, 1, 2]);
  });

  it("drops messages that normalize to zero blocks", () => {
    const normalized = normalizeRequestMessages(
      detailWith([
        { role: "user", content: "" },
        { role: "user", content: "real" },
      ])
    );
    expect(normalized).toHaveLength(1);
    expect(normalized[0].blocks).toEqual([{ type: "text", text: "real" }]);
  });
});

// ---------------------------------------------------------------------------
// analyzeRequestMessages
// ---------------------------------------------------------------------------

describe("analyzeRequestMessages", () => {
  it("reports hasMessages=false and zeroed statistics when nothing to analyze", () => {
    const result = analyzeRequestMessages(null);
    expect(result.hasMessages).toBe(false);
    expect(result.messages).toEqual([]);
    expect(result.stats).toEqual({
      messageCount: 0,
      textBlockCount: 0,
      toolCallCount: 0,
      toolResultCount: 0,
      nonTextBlockCount: 0,
      roleCounts: {},
      totalCharacters: 0,
    });
  });

  it("counts messages, roles, and text characters for a pure-text conversation", () => {
    const { hasMessages, stats } = analyzeRequestMessages(openAiTextDetail);

    expect(hasMessages).toBe(true);
    expect(stats.messageCount).toBe(3);
    expect(stats.textBlockCount).toBe(3);
    expect(stats.toolCallCount).toBe(0);
    expect(stats.toolResultCount).toBe(0);
    expect(stats.nonTextBlockCount).toBe(0);
    expect(stats.roleCounts).toEqual({ system: 1, user: 1, assistant: 1 });
    expect(stats.totalCharacters).toBe(
      "You are a helpful assistant.".length + "What is 2 + 2?".length + "4".length
    );
  });

  it("counts tool calls and tool results for OpenAI payloads", () => {
    const { stats } = analyzeRequestMessages(openAiToolCallsDetail);
    expect(stats.toolCallCount).toBe(1);
    expect(stats.toolResultCount).toBe(1);
    expect(stats.roleCounts).toEqual({ user: 1, assistant: 1, tool: 1 });
  });

  it("counts tool_use as tool calls and tool_result as tool results for Anthropic payloads", () => {
    const { stats } = analyzeRequestMessages(anthropicBlocksDetail);
    expect(stats.toolCallCount).toBe(1);
    expect(stats.toolResultCount).toBe(1);
    expect(stats.textBlockCount).toBe(2);
  });

  it("counts image/unknown blocks as non-text without inflating tool counts", () => {
    const { stats } = analyzeRequestMessages(
      detailWith([
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image", source: { data: "AAAA" } },
            { type: "document", source: { data: "BBBB" } },
          ],
        },
      ])
    );

    expect(stats.textBlockCount).toBe(1);
    expect(stats.nonTextBlockCount).toBe(2);
    expect(stats.toolCallCount).toBe(0);
    expect(stats.toolResultCount).toBe(0);
  });

  it("exposes normalized messages alongside statistics", () => {
    const result = analyzeRequestMessages(openAiTextDetail);
    expect(result.messages).toEqual(normalizeRequestMessages(openAiTextDetail));
  });

  it("does not mutate the input detail", () => {
    const detail = detailWith([{ role: "user", content: "hi" }]);
    const snapshot = JSON.stringify(detail);
    analyzeRequestMessages(detail);
    expect(JSON.stringify(detail)).toBe(snapshot);
  });
});
