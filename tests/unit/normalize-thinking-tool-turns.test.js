import { describe, it, expect } from "vitest";
import { normalizeThinkingConfig } from "../../open-sse/services/provider.js";

const thinking = { type: "enabled", budget_tokens: 1024 };

describe("normalizeThinkingConfig on tool-result turns (#5171)", () => {
  it("keeps thinking when last OpenAI message is role 'tool'", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "f", arguments: "{}" } }] },
        { role: "tool", tool_call_id: "c1", content: "result" },
      ],
      thinking: { ...thinking },
    };
    normalizeThinkingConfig(body);
    expect(body.thinking).toEqual(thinking);
  });

  it("keeps thinking when last Claude message is user carrying tool_result blocks", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "f", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
      ],
      thinking: { ...thinking },
    };
    normalizeThinkingConfig(body);
    expect(body.thinking).toEqual(thinking);
  });

  it("keeps thinking when last role is 'user'", () => {
    const body = {
      messages: [{ role: "user", content: "hi" }],
      thinking: { ...thinking },
    };
    normalizeThinkingConfig(body);
    expect(body.thinking).toEqual(thinking);
  });

  it("keeps thinking when Gemini contents end with role 'function'", () => {
    const body = {
      contents: [
        { role: "user", parts: [{ text: "hi" }] },
        { role: "model", parts: [{ functionCall: { name: "f", args: {} } }] },
        { role: "function", parts: [{ functionResponse: { name: "f", response: {} } }] },
      ],
      thinking: { ...thinking },
    };
    normalizeThinkingConfig(body);
    expect(body.thinking).toEqual(thinking);
  });

  it("strips thinking when last message is assistant prefill", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "partial" },
      ],
      thinking: { ...thinking },
    };
    normalizeThinkingConfig(body);
    expect(body.thinking).toBeUndefined();
  });

  it("strips thinking when Gemini contents end with role 'model' (prefill)", () => {
    const body = {
      contents: [
        { role: "user", parts: [{ text: "hi" }] },
        { role: "model", parts: [{ text: "partial" }] },
      ],
      thinking: { ...thinking },
    };
    normalizeThinkingConfig(body);
    expect(body.thinking).toBeUndefined();
  });
});
