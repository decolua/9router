// A1: locks toOpenAIFinish/fromOpenAIFinish behavior changes vs open-sse.old.
import { describe, it, expect } from "vitest";
import { toOpenAIFinish, fromOpenAIFinish } from "../../open-sse/translator/concerns/finishReason.js";
import { OPENAI_FINISH, CLAUDE_STOP, GEMINI_FINISH } from "../../open-sse/translator/schema/finishReasons.js";

describe("toOpenAIFinish - gemini", () => {
  it.each([
    ["SAFETY", "content_filter"],
    ["RECITATION", "content_filter"],
    ["BLOCKLIST", "content_filter"],
    ["PROHIBITED_CONTENT", "content_filter"],
    ["OTHER", "stop"],
    ["UNKNOWN_XYZ", "stop"],
    ["STOP", "stop"],
    ["MAX_TOKENS", "length"],
  ])("%s -> %s", (input, expected) => {
    expect(toOpenAIFinish(input, "gemini")).toBe(expected);
  });
});

describe("toOpenAIFinish - ollama", () => {
  it.each([
    ["length", "length"],
    ["max_tokens", "length"],
    ["tool_calls", "tool_calls"],
    ["unknown_xyz", "stop"],
  ])("%s -> %s", (input, expected) => {
    expect(toOpenAIFinish(input, "ollama")).toBe(expected);
  });
});

describe("toOpenAIFinish - kiro", () => {
  it("tool_use -> tool_calls", () => {
    expect(toOpenAIFinish("tool_use", "kiro")).toBe("tool_calls");
  });
});

describe("toOpenAIFinish - claude", () => {
  it.each([
    ["end_turn", "stop"],
    ["max_tokens", "length"],
    ["tool_use", "tool_calls"],
  ])("%s -> %s", (input, expected) => {
    expect(toOpenAIFinish(input, "claude")).toBe(expected);
  });
});

describe("toOpenAIFinish - commandcode", () => {
  it("tool-calls -> tool_calls", () => {
    expect(toOpenAIFinish("tool-calls", "commandcode")).toBe("tool_calls");
  });
  it("unknown passthrough", () => {
    expect(toOpenAIFinish("xyz", "commandcode")).toBe("xyz");
  });
});

describe("fromOpenAIFinish round-trip - claude", () => {
  it("tool_calls -> tool_use", () => {
    expect(fromOpenAIFinish("tool_calls", "claude")).toBe("tool_use");
  });
  it("length -> max_tokens", () => {
    expect(fromOpenAIFinish("length", "claude")).toBe("max_tokens");
  });
});

describe("enum literals (catch drift)", () => {
  it("OPENAI_FINISH literals", () => {
    expect(OPENAI_FINISH.STOP).toBe("stop");
    expect(OPENAI_FINISH.LENGTH).toBe("length");
    expect(OPENAI_FINISH.TOOL_CALLS).toBe("tool_calls");
    expect(OPENAI_FINISH.CONTENT_FILTER).toBe("content_filter");
  });
  it("CLAUDE_STOP literals", () => {
    expect(CLAUDE_STOP.END_TURN).toBe("end_turn");
    expect(CLAUDE_STOP.MAX_TOKENS).toBe("max_tokens");
    expect(CLAUDE_STOP.TOOL_USE).toBe("tool_use");
  });
  it("GEMINI_FINISH literals", () => {
    expect(GEMINI_FINISH.STOP).toBe("STOP");
    expect(GEMINI_FINISH.MAX_TOKENS).toBe("MAX_TOKENS");
    expect(GEMINI_FINISH.SAFETY).toBe("SAFETY");
  });
});
