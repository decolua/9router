import { describe, it, expect } from "vitest";
import { deriveModerationsUrl } from "../../open-sse/handlers/moderationsCore.js";

// The novel logic in moderationsCore is the /moderations URL derivation from a
// provider's chat completions baseUrl. proxyAwareFetch captures originalFetch at
// import time, so the forwarding path can't be unit-tested via globalThis.fetch
// mocking; the URL derivation (the part that can break) is exercised directly here.
describe("deriveModerationsUrl", () => {
  it("swaps /v1/chat/completions → /v1/moderations (openai)", () => {
    expect(deriveModerationsUrl("https://api.openai.com/v1/chat/completions")).toBe(
      "https://api.openai.com/v1/moderations"
    );
  });

  it("tolerates the /openai segment (deepinfra-style)", () => {
    expect(deriveModerationsUrl("https://api.deepinfra.com/v1/openai/chat/completions")).toBe(
      "https://api.deepinfra.com/v1/openai/moderations"
    );
  });

  it("handles /v2/chat/completions style paths", () => {
    expect(deriveModerationsUrl("https://api.example.com/v2/chat/completions")).toBe(
      "https://api.example.com/v2/moderations"
    );
  });

  it("falls back to dropping the last segment when there is no /chat/completions suffix", () => {
    expect(deriveModerationsUrl("https://api.example.com/v1/standalone")).toBe(
      "https://api.example.com/v1/moderations"
    );
  });

  it("preserves a non-standard port", () => {
    expect(deriveModerationsUrl("http://localhost:8080/v1/chat/completions")).toBe(
      "http://localhost:8080/v1/moderations"
    );
  });
});
