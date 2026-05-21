import { describe, it, expect } from "vitest";
import { convertOpenAIContentToParts } from "../../open-sse/translator/helpers/geminiHelper.js";
import { openaiToGeminiRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

describe("openaiToGeminiRequest image forwarding", () => {
  it("should convert AI SDK image content part to Gemini inlineData", () => {
    const fakeBase64 = "iVBORw0KGgo=";
    const result = openaiToGeminiRequest("gemini-2.5-pro", {
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Describe this image" },
          { type: "image", image: `data:image/png;base64,${fakeBase64}` }
        ]
      }]
    }, true);

    expect(result.contents[0].parts).toEqual([
      { text: "Describe this image" },
      { inlineData: { mime_type: "image/png", data: fakeBase64 } }
    ]);
  });
});

describe("convertOpenAIContentToParts", () => {
  it("should preserve existing image_url data URL handling", () => {
    const fakeBase64 = "abc123";
    const parts = convertOpenAIContentToParts([
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${fakeBase64}` } }
    ]);

    expect(parts).toEqual([
      { inlineData: { mime_type: "image/jpeg", data: fakeBase64 } }
    ]);
  });
});
