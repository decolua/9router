import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {})
}));

const { extractUsageFromResponse } = await import("../../open-sse/handlers/chatCore/requestDetail.js");

const USAGE_METADATA = {
  promptTokenCount: 1234,
  candidatesTokenCount: 56,
  cachedContentTokenCount: 78,
  thoughtsTokenCount: 90,
};

const EXPECTED = {
  prompt_tokens: 1234,
  // Gemini reports thoughts separately, while 9router completion usage is
  // reasoning-inclusive like the OpenAI/Claude normalized shapes.
  completion_tokens: 146,
  cached_tokens: 78,
  reasoning_tokens: 90,
};

describe("#3260 non-streaming usage extraction for enveloped Gemini responses", () => {
  it("reads usageMetadata out of the antigravity { response } envelope", () => {
    expect(extractUsageFromResponse({ response: { usageMetadata: USAGE_METADATA } })).toEqual(EXPECTED);
  });

  it("still reads a top-level usageMetadata", () => {
    expect(extractUsageFromResponse({ usageMetadata: USAGE_METADATA })).toEqual(EXPECTED);
  });

  it("prefers the top-level metadata when both are present", () => {
    const enveloped = { ...USAGE_METADATA, promptTokenCount: 1 };
    const out = extractUsageFromResponse({
      usageMetadata: USAGE_METADATA,
      response: { usageMetadata: enveloped },
    });
    expect(out.prompt_tokens).toBe(1234);
  });

  it("leaves the OpenAI and Claude shapes alone", () => {
    expect(extractUsageFromResponse({ usage: { prompt_tokens: 10, completion_tokens: 2 } }))
      .toMatchObject({ prompt_tokens: 10, completion_tokens: 2 });
    expect(extractUsageFromResponse({ usage: { input_tokens: 10, output_tokens: 2 } }))
      .toMatchObject({ prompt_tokens: 10, completion_tokens: 2 });
  });

  it("returns null when there is no usage anywhere", () => {
    expect(extractUsageFromResponse({ response: { candidates: [] } })).toBeNull();
    expect(extractUsageFromResponse(null)).toBeNull();
  });
});
