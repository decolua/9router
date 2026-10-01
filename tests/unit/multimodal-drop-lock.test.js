// Locks multimodal quirks flagged in docs 11 §4: image_url.detail drop + input_audio per-format.
import { describe, it, expect } from "vitest";
import { openaiToClaudeRequest } from "../../open-sse/translator/request/openai-to-claude.js";
import { convertOpenAIContentToParts } from "../../open-sse/translator/formats/gemini.js";

function userImage(detail) {
  return {
    model: "claude-sonnet-4-6",
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "look" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAAB", detail } },
      ],
    }],
  };
}

describe("openai→claude: image_url.detail is dropped (docs 11 §4)", () => {
  it("converts image to base64 source WITHOUT a detail field", () => {
    const out = openaiToClaudeRequest("claude-sonnet-4-6", userImage("high"), false);
    const imgBlock = out.messages[0].content.find((b) => b.type === "image");
    expect(imgBlock).toBeTruthy();
    expect(imgBlock.source).toEqual({ type: "base64", media_type: "image/png", data: "AAAB" });
    expect("detail" in imgBlock).toBe(false);
    expect("detail" in imgBlock.source).toBe(false);
  });

  it("drops input_audio entirely (claude has no audio block)", () => {
    const body = {
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: [
        { type: "text", text: "hi" },
        { type: "input_audio", input_audio: { data: "ZZZ", format: "wav" } },
      ] }],
    };
    const out = openaiToClaudeRequest("claude-sonnet-4-6", body, false);
    const blocks = out.messages[0].content;
    expect(blocks.some((b) => b.type === "audio" || b.type === "input_audio")).toBe(false);
  });
});

describe("openai→gemini: input_audio is mapped to inlineData (docs 11 §4)", () => {
  it("maps wav → audio/wav inlineData", () => {
    const parts = convertOpenAIContentToParts([{ type: "input_audio", input_audio: { data: "ZZZ", format: "wav" } }]);
    expect(parts).toEqual([{ inlineData: { mime_type: "audio/wav", data: "ZZZ" } }]);
  });

  it("maps mp3 → audio/mpeg inlineData", () => {
    const parts = convertOpenAIContentToParts([{ type: "input_audio", input_audio: { data: "ZZZ", format: "mp3" } }]);
    expect(parts[0].inlineData.mime_type).toBe("audio/mpeg");
  });

  it("drops image_url.detail (not carried into inlineData)", () => {
    const parts = convertOpenAIContentToParts([{ type: "image_url", image_url: { url: "data:image/png;base64,AAAB", detail: "high" } }]);
    expect(parts).toEqual([{ inlineData: { mime_type: "image/png", data: "AAAB" } }]);
  });
});
