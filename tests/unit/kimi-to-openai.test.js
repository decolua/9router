import { describe, expect, it } from "vitest";
import { convertKimiToOpenAI } from "../../open-sse/translator/response/kimi-to-openai.js";

describe("kimi-to-openai response translator", () => {
  it("passes through standard OpenAI chunks unchanged", () => {
    const chunk = {
      id: "chatcmpl-123",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { content: "hello" }, finish_reason: null }]
    };
    const state = {};
    expect(convertKimiToOpenAI(chunk, state)).toEqual(chunk);
  });

  it("maps delta.reasoning to delta.reasoning_content", () => {
    const chunk = {
      id: "chatcmpl-123",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { reasoning: "let me think" }, finish_reason: null }]
    };
    const state = {};
    const result = convertKimiToOpenAI(chunk, state);
    expect(result.choices[0].delta.reasoning_content).toBe("let me think");
    expect(result.choices[0].delta.reasoning).toBeUndefined();
  });

  it("maps delta.thinking to delta.reasoning_content", () => {
    const chunk = {
      id: "chatcmpl-123",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { thinking: "pondering..." }, finish_reason: null }]
    };
    const state = {};
    const result = convertKimiToOpenAI(chunk, state);
    expect(result.choices[0].delta.reasoning_content).toBe("pondering...");
    expect(result.choices[0].delta.thinking).toBeUndefined();
  });

  it("extracts <thinking> tags from content into reasoning_content", () => {
    const chunk = {
      id: "chatcmpl-123",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { content: "<thinking>deep thought</thinking>answer" }, finish_reason: null }]
    };
    const state = {};
    const result = convertKimiToOpenAI(chunk, state);
    expect(result.choices[0].delta.reasoning_content).toBe("deep thought");
    expect(result.choices[0].delta.content).toBe("answer");
  });

  it("accumulates reasoning across multiple chunks in state", () => {
    const state = {};
    const chunk1 = {
      id: "chatcmpl-123",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { reasoning_content: "part1" }, finish_reason: null }]
    };
    convertKimiToOpenAI(chunk1, state);
    const chunk2 = {
      id: "chatcmpl-123",
      object: "chat.completion.chunk",
      choices: [{ index: 0, delta: { reasoning_content: "part2" }, finish_reason: null }]
    };
    convertKimiToOpenAI(chunk2, state);
    expect(state.kimiReasoningBuf).toBe("part1part2");
  });

  it("ignores non-JSON string chunks", () => {
    expect(convertKimiToOpenAI("not json", {})).toBeNull();
  });
});