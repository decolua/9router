import { describe, it, expect } from "vitest";
import { openaiToOllamaRequest } from "../../open-sse/translator/request/openai-to-ollama.js";

describe("openaiToOllamaRequest image forwarding", () => {
  it("should extract raw base64 from AI SDK image content part", () => {
    const fakeBase64 = "iVBORw0KGgo=";
    const result = openaiToOllamaRequest("llava", {
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Describe this image" },
          { type: "image", image: `data:image/png;base64,${fakeBase64}` }
        ]
      }]
    }, true);

    expect(result.messages[0]).toEqual({
      role: "user",
      content: "Describe this image",
      images: [fakeBase64]
    });
  });
});
