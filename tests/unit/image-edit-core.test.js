import { describe, it, expect } from "vitest";
import { deriveImageEditsUrl } from "../../open-sse/handlers/imageEditCore.js";

// The novel logic in imageEditCore is the /images/edits URL derivation from a
// provider's image generations URL. proxyAwareFetch captures originalFetch at
// import, so the forwarding path can't be fetch-mocked; the derivation logic
// (the part that can break) is exercised directly here.
describe("deriveImageEditsUrl", () => {
  it("swaps /images/generations → /images/edits (openai)", () => {
    expect(deriveImageEditsUrl({ baseUrl: "https://api.openai.com/v1/images/generations" })).toBe(
      "https://api.openai.com/v1/images/edits"
    );
  });

  it("works for providers with a non-standard host", () => {
    expect(deriveImageEditsUrl({ baseUrl: "https://images.example.net/v1/images/generations" })).toBe(
      "https://images.example.net/v1/images/edits"
    );
  });

  it("returns null when baseUrl lacks the /images/generations suffix", () => {
    expect(deriveImageEditsUrl({ baseUrl: "https://api.example.com/v1/generate" })).toBe(null);
  });

  it("returns null when imageConfig is missing or has no baseUrl", () => {
    expect(deriveImageEditsUrl({})).toBe(null);
    expect(deriveImageEditsUrl(null)).toBe(null);
    expect(deriveImageEditsUrl(undefined)).toBe(null);
  });

  it("returns null for adapter URLs that don't follow the OpenAI generations pattern", () => {
    expect(deriveImageEditsUrl({ baseUrl: "https://api.stability.ai/v2beta/stable-image/generate/core" })).toBe(null);
  });
});
