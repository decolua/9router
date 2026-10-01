import { describe, expect, it } from "vitest";

import { convertResponsesApiFormat } from "../../open-sse/translator/formats/responsesApi.js";

describe("convertResponsesApiFormat", () => {
  it("preserves prompt_cache_key", () => {
    const result = convertResponsesApiFormat({
      input: "Hello",
      prompt_cache_key: "conversation-123",
    });

    expect(result.prompt_cache_key).toBe("conversation-123");
  });
});
