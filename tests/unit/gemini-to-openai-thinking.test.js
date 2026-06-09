import { describe, expect, it } from "vitest";

import { geminiToOpenAIResponse } from "../../open-sse/translator/response/gemini-to-openai.js";

function convert(parts) {
  const state = { toolCalls: new Map() };
  const chunks = geminiToOpenAIResponse({
    responseId: "gemma-thinking-test",
    modelVersion: "gemma-4-31b",
    candidates: [{
      content: { role: "model", parts },
      finishReason: "STOP",
    }],
  }, state);
  return chunks;
}

describe("gemini-to-openai thinking parts", () => {
  it("maps thought text without thoughtSignature to reasoning_content, not content", () => {
    const chunks = convert([
      { thought: true, text: 'The user said "Hello World". Plan the greeting.' },
      { text: "Hello! How can I help you today?" },
    ]);

    const deltas = chunks.map((chunk) => chunk.choices[0].delta);

    expect(deltas).toContainEqual({ reasoning_content: 'The user said "Hello World". Plan the greeting.' });
    expect(deltas).toContainEqual({ content: "Hello! How can I help you today?" });
    expect(deltas.some((delta) => delta.content?.includes("Plan the greeting"))).toBe(false);
  });

  it("continues to map signed thought text to reasoning_content", () => {
    const chunks = convert([
      { thought: true, thoughtSignature: "sig", text: "internal plan" },
      { thoughtSignature: "sig", text: "final answer" },
    ]);

    const deltas = chunks.map((chunk) => chunk.choices[0].delta);

    expect(deltas).toContainEqual({ reasoning_content: "internal plan" });
    expect(deltas).toContainEqual({ content: "final answer" });
  });
});
