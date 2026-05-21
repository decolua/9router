import { describe, it, expect } from "vitest";
import { openaiToOpenAIResponsesRequest } from "../../open-sse/translator/request/openai-responses.js";

describe("openaiToOpenAIResponsesRequest image forwarding", () => {
  it("should convert AI SDK image content part to input_image", () => {
    const imageUrl = "data:image/png;base64,iVBORw0KGgo=";
    const result = openaiToOpenAIResponsesRequest("gpt-5.2", {
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "Describe this image" },
          { type: "image", image: imageUrl, detail: "high" }
        ]
      }]
    }, true, {});

    expect(result.input[0].content).toEqual([
      { type: "input_text", text: "Describe this image" },
      { type: "input_image", image_url: imageUrl, detail: "high" }
    ]);
  });
});
