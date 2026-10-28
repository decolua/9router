// hasMediaBlocks: serialized media detection gating behavioral style prompts.
// One scanner, every wire shape: Claude blocks, OpenAI chat parts, Responses
// input, Gemini parts, plus tool_result-carried images (the Claude Code
// screenshot path).
import { describe, it, expect } from "vitest";
import { hasMediaBlocks } from "../../open-sse/translator/concerns/modality.js";

describe("hasMediaBlocks", () => {
  // Claude user-message image
  it("detects claude image block", () => {
    const body = { messages: [{ role: "user", content: [
      { type: "text", text: "hi" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } },
    ] }] };
    expect(hasMediaBlocks(body)).toBe(true);
  });

  // Claude tool_result image (Claude Code screenshots arrive this way)
  it("detects image inside tool_result content", () => {
    const body = { messages: [{ role: "user", content: [
      { type: "tool_result", tool_use_id: "t1", content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: "AAA" } },
      ] },
    ] }] };
    expect(hasMediaBlocks(body)).toBe(true);
  });

  it("detects claude document block", () => {
    const body = { messages: [{ role: "user", content: [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: "AAA" } },
    ] }] };
    expect(hasMediaBlocks(body)).toBe(true);
  });

  // OpenAI chat
  it("detects openai image_url part", () => {
    const body = { messages: [{ role: "user", content: [
      { type: "text", text: "hi" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
    ] }] };
    expect(hasMediaBlocks(body)).toBe(true);
  });

  it("detects openai input_audio part", () => {
    const body = { messages: [{ role: "user", content: [
      { type: "input_audio", input_audio: { data: "AAA", format: "wav" } },
    ] }] };
    expect(hasMediaBlocks(body)).toBe(true);
  });

  // OpenAI Responses input
  it("detects responses input_image", () => {
    const body = { input: [{ role: "user", content: [
      { type: "input_text", text: "hi" },
      { type: "input_image", image_url: "data:image/png;base64,AAA" },
    ] }] };
    expect(hasMediaBlocks(body)).toBe(true);
  });

  // Gemini
  it("detects gemini inlineData part", () => {
    const body = { contents: [{ role: "user", parts: [
      { text: "hi" },
      { inlineData: { mimeType: "image/png", data: "AAA" } },
    ] }] };
    expect(hasMediaBlocks(body)).toBe(true);
  });

  // Text-only requests: no media → false (ponytail applies)
  it("text-only claude body is not flagged", () => {
    const body = { system: "x", messages: [{ role: "user", content: [
      { type: "text", text: "just text" },
    ] }], tools: [{ name: "read_file", input_schema: { type: "object", properties: { path: { type: "string" } } } }] };
    expect(hasMediaBlocks(body)).toBe(false);
  });

  // Tool schemas mentioning "image" as a property name must not trip the scan.
  it("tool schema with image property name is not flagged", () => {
    const body = { tools: [{ name: "screenshot", input_schema: { type: "object", properties: {
      image: { type: "string", description: "image id" },
    } } }] };
    expect(hasMediaBlocks(body)).toBe(false);
  });

  it("returns false on null/undefined/primitives", () => {
    expect(hasMediaBlocks(null)).toBe(false);
    expect(hasMediaBlocks(undefined)).toBe(false);
    expect(hasMediaBlocks("string")).toBe(false);
    expect(hasMediaBlocks(42)).toBe(false);
  });
});
