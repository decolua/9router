import { describe, it, expect } from "vitest";
import { AI_PROVIDERS } from "../../src/shared/constants/providers";

describe("Dynamic Provider Models Configuration", () => {
  it("should have modelsFetcher metadata for kilocode", () => {
    const kilocode = AI_PROVIDERS.kilocode;
    expect(kilocode).toBeDefined();
    expect(kilocode.modelsFetcher).toBeDefined();
    expect(kilocode.modelsFetcher.url).toBe("/api/providers/kilo/free-models");
    expect(kilocode.passthroughModels).toBe(true);
  });

  it("should have modelsFetcher for opencode", () => {
    const opencode = AI_PROVIDERS.opencode;
    expect(opencode).toBeDefined();
    expect(opencode.modelsFetcher).toBeDefined();
    expect(opencode.passthroughModels).toBe(true);
  });

  it("should have modelsFetcher for openrouter", () => {
    const openrouter = AI_PROVIDERS.openrouter;
    expect(openrouter).toBeDefined();
    expect(openrouter.modelsFetcher).toBeDefined();
    expect(openrouter.passthroughModels).toBe(true);
  });

  it("should correctly identify all providers that need dynamic model fetching", () => {
    const dynamicProviders = Object.values(AI_PROVIDERS).filter(p => p.modelsFetcher);
    const dynamicIds = dynamicProviders.map(p => p.id);
    
    expect(dynamicIds).toContain("kilocode");
    expect(dynamicIds).toContain("opencode");
    expect(dynamicIds).toContain("openrouter");
  });

  it("should ensure passthrough providers with fetchers have consistent metadata", () => {
    // These providers use dynamic fetching AND passthrough (critical for combo editing)
    const passthroughWithFetcher = ["kilocode", "openrouter", "opencode"];
    
    passthroughWithFetcher.forEach(id => {
      const p = AI_PROVIDERS[id];
      expect(p, `Provider ${id} should be defined`).toBeDefined();
      expect(p.passthroughModels, `Provider ${id} should have passthroughModels: true`).toBe(true);
      expect(p.modelsFetcher, `Provider ${id} should have a modelsFetcher defined`).toBeDefined();
    });
  });
});
