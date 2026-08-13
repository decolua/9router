import { describe, it, expect } from "vitest";

describe("SearXNG appears in webSearch combo picker (#3269)", () => {
  it("SearXNG is registered and visible as a no-auth webSearch provider", async () => {
    const mod = await import("../../src/shared/constants/providers.js");
    const { AI_PROVIDERS, getProvidersByKind, FREE_PROVIDERS, FREE_TIER_PROVIDERS } = mod;

    // SearXNG is registered with webSearch service kind and no auth
    expect(AI_PROVIDERS.searxng).toBeDefined();
    expect(AI_PROVIDERS.searxng.serviceKinds).toContain("webSearch");
    expect(AI_PROVIDERS.searxng.noAuth).toBe(true);

    // It shows up in the webSearch provider listing
    const ids = getProvidersByKind("webSearch").map((p) => p.id);
    expect(ids).toContain("searxng");

    // Replicates the NO_AUTH_PROVIDER_IDS computation from ModelSelectModal (#3269).
    // Before the fix this only scanned FREE_PROVIDERS, so SearXNG (category: freeTier)
    // was missing and could not be added to a Web Search combo.
    const noAuthIds = [
      ...Object.keys(FREE_PROVIDERS),
      ...Object.keys(FREE_TIER_PROVIDERS),
    ].filter((id) => (FREE_PROVIDERS[id] || FREE_TIER_PROVIDERS[id])?.noAuth);
    expect(noAuthIds).toContain("searxng");
  });
});
