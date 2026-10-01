import { describe, it, expect } from "vitest";
import { normalizeGeminiContents } from "../../open-sse/translator/formats/gemini.js";

describe("normalizeGeminiContents terminal turn guards", () => {
  it("appends user Continue turn when ending with model text turn", () => {
    const contents = [
      { role: "user", parts: [{ text: "hi" }] },
      { role: "model", parts: [{ text: "hello" }] }
    ];
    const out = normalizeGeminiContents(contents);
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({ role: "user", parts: [{ text: "Continue." }] });
  });

  it("appends functionResponse user turn when ending with functionCall", () => {
    const contents = [
      { role: "user", parts: [{ text: "run" }] },
      {
        role: "model",
        parts: [
          { functionCall: { id: "call_1", name: "search", args: { q: "test" } } }
        ]
      }
    ];
    const out = normalizeGeminiContents(contents);
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({
      role: "user",
      parts: [
        {
          functionResponse: {
            id: "call_1",
            name: "search",
            response: { result: "Continue." }
          }
        }
      ]
    });
  });

  it("handles multiple functionCalls in terminal model turn", () => {
    const contents = [
      { role: "user", parts: [{ text: "run" }] },
      {
        role: "model",
        parts: [
          { functionCall: { id: "call_1", name: "fn_1" } },
          { functionCall: { id: "call_2", name: "fn_2" } }
        ]
      }
    ];
    const out = normalizeGeminiContents(contents);
    expect(out).toHaveLength(3);
    expect(out[2].parts).toHaveLength(2);
    expect(out[2].parts[0].functionResponse.id).toBe("call_1");
    expect(out[2].parts[1].functionResponse.id).toBe("call_2");
  });

  it("handles terminal model turn with both text and functionCall", () => {
    const contents = [
      { role: "user", parts: [{ text: "run" }] },
      {
        role: "model",
        parts: [
          { text: "Executing..." },
          { functionCall: { id: "call_3", name: "exec" } }
        ]
      }
    ];
    const out = normalizeGeminiContents(contents);
    expect(out).toHaveLength(3);
    expect(out[2].parts[0].functionResponse.id).toBe("call_3");
  });

  it("handles single model turn by prepending user prompt and appending terminal user", () => {
    const contents = [{ role: "model", parts: [{ text: "prefill" }] }];
    const out = normalizeGeminiContents(contents);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ role: "user", parts: [{ text: "..." }] });
    expect(out[1]).toEqual({ role: "model", parts: [{ text: "prefill" }] });
    expect(out[2]).toEqual({ role: "user", parts: [{ text: "Continue." }] });
  });

  it("does not mutate payloads already ending with a user turn", () => {
    const contents = [{ role: "user", parts: [{ text: "question" }] }];
    const out = normalizeGeminiContents(contents);
    expect(out).toHaveLength(1);
    expect(out[0].role).toBe("user");
  });

  it("handles functionCall without name or id with fallback defaults", () => {
    const contents = [
      { role: "user", parts: [{ text: "Go" }] },
      { role: "model", parts: [{ functionCall: {} }] }
    ];
    const out = normalizeGeminiContents(contents);
    expect(out).toHaveLength(3);
    expect(out[2].parts[0]).toEqual({
      functionResponse: {
        name: "tool",
        response: { result: "Continue." }
      }
    });
    expect(out[2].parts[0].functionResponse.id).toBeUndefined();
  });

  it("merges adjacent model turns before appending terminal user turn", () => {
    const contents = [
      { role: "user", parts: [{ text: "Prompt" }] },
      { role: "model", parts: [{ text: "Part A" }] },
      { role: "model", parts: [{ text: "Part B" }] }
    ];
    const out = normalizeGeminiContents(contents);
    expect(out).toHaveLength(3);
    expect(out[1].role).toBe("model");
    expect(out[1].parts).toHaveLength(2);
    expect(out[2]).toEqual({ role: "user", parts: [{ text: "Continue." }] });
  });

  it("appends user Continue turn when terminal model turn has thought parts", () => {
    const contents = [
      { role: "user", parts: [{ text: "Solve math" }] },
      {
        role: "model",
        parts: [
          { thought: true, text: "Let 2x = 4..." },
          { thoughtSignature: "sig123", text: "" }
        ]
      }
    ];
    const out = normalizeGeminiContents(contents);
    expect(out).toHaveLength(3);
    expect(out[2]).toEqual({ role: "user", parts: [{ text: "Continue." }] });
  });

  it("handles empty, null, and undefined inputs gracefully", () => {
    expect(normalizeGeminiContents([])).toEqual([]);
    expect(normalizeGeminiContents(null)).toEqual([]);
    expect(normalizeGeminiContents(undefined)).toEqual([]);
  });
});
