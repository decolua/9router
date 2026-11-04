import { describe, expect, it } from "vitest";
import { supportsModelListing } from "../../src/lib/providerModels/fetchModels.js";

describe("model-listing support", () => {
  it("supports user-added compatible nodes", () => {
    expect(supportsModelListing("openai-compatible-chat-abc")).toBe(true);
    expect(supportsModelListing("anthropic-compatible-xyz")).toBe(true);
  });

  it("supports providers with an explicit config entry", () => {
    expect(supportsModelListing("deepseek")).toBe(true);
    expect(supportsModelListing("groq")).toBe(true);
    expect(supportsModelListing("kiro")).toBe(true);
  });

  it("supports providers that only declare a registry modelsFetcher", () => {
    // These have no hand-written entry in PROVIDER_MODELS_CONFIG; the registry
    // fetcher is what makes them refreshable.
    expect(supportsModelListing("kilocode")).toBe(true);
    expect(supportsModelListing("opencode")).toBe(true);
    expect(supportsModelListing("openrouter")).toBe(true);
  });

  it("supports a registry provider whose base URL yields a /models endpoint", () => {
    // Added upstream with only a transport baseUrl - previously invisible here.
    expect(supportsModelListing("glm-cn")).toBe(true);
    expect(supportsModelListing("cline")).toBe(true);
    expect(supportsModelListing("bazaarlink")).toBe(true);
    expect(supportsModelListing("kilo-gateway")).toBe(true);
    expect(supportsModelListing("xiaomi-tokenplan")).toBe(true);
  });

  it("supports a provider whose base URL needs an account placeholder", () => {
    // {accountId} is filled from the connection at fetch time, so the provider
    // is refreshable even though the raw URL is not directly usable.
    expect(supportsModelListing("cloudflare-ai")).toBe(true);
  });

  it("does not claim support for search/embedding-only providers", () => {
    // They expose no chat catalogue; listing them would only guarantee failures.
    for (const id of ["exa", "firecrawl", "jina-ai", "jina-reader", "serper", "tavily"]) {
      expect(supportsModelListing(id), id).toBe(false);
    }
  });

  it("does not claim support for a provider that does not exist", () => {
    expect(supportsModelListing("no-such-provider-xyz")).toBe(false);
  });
});
