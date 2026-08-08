import { describe, expect, it } from "vitest";
import { extractUsageFromResponse } from "../../open-sse/handlers/chatCore/requestDetail.js";

describe("request detail usage extraction", () => {
  it("extracts usage from Antigravity wrapped response usageMetadata", () => {
    const usage = extractUsageFromResponse({
      response: {
        usageMetadata: {
          promptTokenCount: 77187,
          candidatesTokenCount: 236,
          totalTokenCount: 77423,
          cachedContentTokenCount: 69387,
          thoughtsTokenCount: 12,
        },
      },
    });

    expect(usage).toEqual({
      prompt_tokens: 77187,
      completion_tokens: 236,
      cached_tokens: 69387,
      reasoning_tokens: 12,
    });
  });
});
