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
  completion_tokens: 56,
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

  it("extracts OpenAI-compatible cache hit and miss aliases", () => {
    expect(extractUsageFromResponse({
      usage: {
        prompt_tokens: 500,
        completion_tokens: 50,
        prompt_cache_hit_tokens: 120,
        prompt_cache_miss_tokens: 380,
      },
    })).toMatchObject({
      prompt_tokens: 500,
      completion_tokens: 50,
      cached_tokens: 120,
      cache_creation_input_tokens: 380,
    });
  });

  it("keeps Responses API cached tokens as a subset of input tokens", () => {
    expect(extractUsageFromResponse({
      usage: {
        input_tokens: 500,
        output_tokens: 50,
        input_tokens_details: { cached_tokens: 120 },
      },
    })).toMatchObject({
      prompt_tokens: 500,
      completion_tokens: 50,
      cached_tokens: 120,
    });
  });

  it("returns null when there is no usage anywhere", () => {
    expect(extractUsageFromResponse({ response: { candidates: [] } })).toBeNull();
    expect(extractUsageFromResponse(null)).toBeNull();
  });
});
