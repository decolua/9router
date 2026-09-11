// Regression for #3972: an OpenAI request may carry several `system` messages
// (system prompt + injected instructions). The OpenAI → Gemini translator used
// to assign `systemInstruction` inside the message loop, so each system message
// replaced the previous one and only the last survived. Every system message
// must land in `systemInstruction`, in order.
import { describe, it, expect } from "vitest";
import { openaiToGeminiRequest, openaiToGeminiCLIRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

describe("OpenAI → Gemini keeps every system message (#3972)", () => {
  it("collects multiple system messages into systemInstruction parts, in order", () => {
    const body = {
      messages: [
        { role: "system", content: "System A" },
        { role: "system", content: "System B" },
        { role: "system", content: [{ type: "text", text: "System C" }] },
        { role: "user", content: "Hello" },
      ],
    };
    for (const translate of [openaiToGeminiRequest, openaiToGeminiCLIRequest]) {
      const result = translate("gemini-2.5-pro", body, false);
      expect(result.systemInstruction.parts.map((part) => part.text)).toEqual([
        "System A",
        "System B",
        "System C",
      ]);
      expect(result.systemInstruction.role).toBe("user");
      expect(result.contents).toEqual([{ role: "user", parts: [{ text: "Hello" }] }]);
    }
  });

  it("still emits a single-part systemInstruction for one system message", () => {
    const body = {
      messages: [
        { role: "system", content: "Only one" },
        { role: "user", content: "Hi" },
      ],
    };
    const result = openaiToGeminiRequest("gemini-2.5-pro", body, false);
    expect(result.systemInstruction).toEqual({ role: "user", parts: [{ text: "Only one" }] });
  });

  it("leaves systemInstruction unset without system messages", () => {
    const result = openaiToGeminiRequest("gemini-2.5-pro", { messages: [{ role: "user", content: "Hi" }] }, false);
    expect(result.systemInstruction).toBeUndefined();
  });
});
