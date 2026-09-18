import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { FORMATS } = await import("../../open-sse/translator/formats.js");
const { translateNonStreamingResponse } = await import(
  "../../open-sse/handlers/chatCore/nonStreamingHandler.js"
);

const GEMINI_BODY = (usageMetadata) => ({
  candidates: [
    { content: { parts: [{ text: "hi" }] }, finishReason: "STOP" }
  ],
  usageMetadata
});

const translate = (usageMetadata) =>
  translateNonStreamingResponse(
    GEMINI_BODY(usageMetadata),
    FORMATS.ANTIGRAVITY,
    FORMATS.GEMINI
  );

describe("gemini non-streaming usage totals (#3789)", () => {
  it("falls back to summed parts when totalTokenCount is absent", () => {
    expect(
      translate({ promptTokenCount: 10, candidatesTokenCount: 20 }).usage
    ).toMatchObject({
      prompt_tokens: 10,
      completion_tokens: 20,
      total_tokens: 30
    });
  });

  it("includes thoughts in the prompt part of the fallback sum", () => {
    expect(
      translate({
        promptTokenCount: 10,
        thoughtsTokenCount: 5,
        candidatesTokenCount: 20
      }).usage
    ).toMatchObject({
      prompt_tokens: 15,
      completion_tokens: 20,
      total_tokens: 35
    });
  });

  it("prefers an explicit totalTokenCount when present", () => {
    expect(
      translate({
        promptTokenCount: 10,
        candidatesTokenCount: 20,
        totalTokenCount: 35
      }).usage.total_tokens
    ).toBe(35);
  });
});
