import { describe, expect, it } from "vitest";
import { extractApiKey } from "@/sse/services/auth.js";

describe("inference API key extraction", () => {
  it("accepts Google header and query keys used by Gemini rewrites", () => {
    expect(extractApiKey(new Request("https://router.test/v1beta/models", {
      headers: { "x-goog-api-key": "google-header-key" },
    }))).toBe("google-header-key");
    expect(extractApiKey(new Request("https://router.test/v1beta/models?key=google-query-key"))).toBe("google-query-key");
  });
});
