import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { handleImageGenerationCore } from "../../open-sse/handlers/imageGenerationCore.js";

const originalFetch = global.fetch;

// Regression test for decolua/9router#5190 (part 1): an HTTP(S) image URL
// passed to the Gemini adapter was silently dropped (resolveImageInput
// returned null) and the request went upstream text-only. It must fail
// fast with a descriptive 400 instead.
describe("image URL instead of silent drop (#5190)", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("gemini: HTTP image URL → 400, upstream never called", async () => {
    const result = await handleImageGenerationCore({
      body: { prompt: "edit this", image: "https://example.com/photo.png" },
      modelInfo: { provider: "gemini", model: "gemini-image-preview" },
      credentials: { apiKey: "test-key" },
      log: null,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toMatch(/base64|data URI/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
