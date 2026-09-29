import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("Cheaper Inference provider", () => {
  const entry = REGISTRY.find((e) => e.id === "cheaperinference");

  it("is registered as an OpenAI-compatible apikey provider", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(entry.authType).toBe("apikey");
    expect(entry.alias).toBe("cheaperinference");
    expect(entry.aliases).toContain("cheaper-inference");
  });

  it("points at the OpenAI-compatible base URL", () => {
    expect(PROVIDERS.cheaperinference.baseUrl).toBe("https://api.cheaperinference.com/v1/chat/completions");
    expect(PROVIDERS.cheaperinference.validateUrl).toBe("https://api.cheaperinference.com/v1/models");
    // transport.format defaults to "openai" via the shared provider default
    expect(PROVIDERS.cheaperinference.format).toBe("openai");
  });

  it("declares no provider-wide thinkingFormat so each model resolves its own", () => {
    expect(PROVIDERS.cheaperinference.thinkingFormat).toBeUndefined();
  });

  it("enables dynamic model discovery and passthrough", () => {
    expect(entry.passthroughModels).toBe(true);
    expect(entry.modelsFetcher).toMatchObject({
      url: "https://api.cheaperinference.com/v1/models",
      type: "openai",
    });
  });

  it("exposes a small seed of bare (unprefixed) model ids", () => {
    const ids = (PROVIDER_MODELS.cheaperinference || []).map((m) => m.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain("gpt-5.4-mini");
    expect(ids.every((id) => !id.includes("/"))).toBe(true);
  });

  it("routes through the shared DefaultExecutor (no custom adapter)", () => {
    expect(getExecutor("cheaperinference")).toBeInstanceOf(DefaultExecutor);
  });

  it("resolves per-model capabilities from the shared tables", () => {
    // Bare ids must still reach the canonical family patterns.
    expect(getCapabilitiesForModel("cheaperinference", "gpt-5.4-mini")).toMatchObject({
      vision: true,
      reasoning: true,
      thinkingFormat: "openai",
    });
    expect(getCapabilitiesForModel("cheaperinference", "claude-sonnet-5")).toMatchObject({
      vision: true,
      reasoning: true,
      thinkingFormat: "claude-adaptive",
    });
  });

  it("does not invent capabilities for an uncatalogued model", () => {
    const caps = getCapabilitiesForModel("cheaperinference", "some-unknown-model-x");
    expect(caps.vision).toBe(false);
    expect(caps.reasoning).toBe(false);
    expect(caps.thinkingFormat).toBeNull();
  });

  it("keeps every registry id unique after adding cheaperinference", () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
