import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";

describe("Novita AI provider", () => {
  const novita = REGISTRY.find((e) => e.id === "novita");

  it("is registered as an OpenAI-compatible apikey provider", () => {
    expect(novita).toBeDefined();
    expect(novita.category).toBe("apikey");
    expect(novita.transport.baseUrl).toBe("https://api.novita.ai/openai/v1/chat/completions");
    expect(novita.transport.validateUrl).toBe("https://api.novita.ai/openai/v1/models");
    expect(novita.alias).toBe("novita");
  });

  it("builds into the runtime PROVIDERS map with the openai format default", () => {
    expect(PROVIDERS.novita).toBeDefined();
    expect(PROVIDERS.novita.format).toBe("openai");
    expect(PROVIDERS.novita.baseUrl).toBe("https://api.novita.ai/openai/v1/chat/completions");
  });

  it("exposes its seed models", () => {
    const ids = (PROVIDER_MODELS.novita || []).map((m) => m.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain("deepseek/deepseek-v4-pro");
  });

  it("keeps every registry id unique after adding novita", () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
