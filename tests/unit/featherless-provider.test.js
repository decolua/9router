import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";

describe("Featherless.ai provider", () => {
  const featherless = REGISTRY.find((entry) => entry.id === "featherless");

  it("is registered as an OpenAI-compatible free-tier API-key provider", () => {
    expect(featherless).toBeDefined();
    expect(featherless.category).toBe("freeTier");
    expect(featherless.authType).toBe("apikey");
    expect(featherless.alias).toBe("featherless");
    expect(featherless.aliases).toContain("fl");
    expect(featherless.uiAlias).toBe("fl");
  });

  it("points to Featherless OpenAI-compatible endpoints", () => {
    expect(featherless.transport.baseUrl).toBe("https://api.featherless.ai/v1/chat/completions");
    expect(featherless.transport.validateUrl).toBe("https://api.featherless.ai/v1/models");
  });

  it("builds into the runtime PROVIDERS map with openai defaults", () => {
    expect(PROVIDERS.featherless).toBeDefined();
    expect(PROVIDERS.featherless.format).toBe("openai");
    expect(PROVIDERS.featherless.baseUrl).toBe("https://api.featherless.ai/v1/chat/completions");
  });

  it("ships useful seed models while allowing catalog passthrough", () => {
    const ids = (PROVIDER_MODELS.featherless || []).map((model) => model.id);
    expect(ids).toContain("moonshotai/Kimi-K2-Instruct");
    expect(ids).toContain("deepseek-ai/DeepSeek-V3.1-Terminus");
    expect(featherless.passthroughModels).toBe(true);
  });
});
