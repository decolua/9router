import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";

describe("Venice AI provider", () => {
  const venice = REGISTRY.find((e) => e.id === "venice");

  it("is registered as an OpenAI-compatible apikey provider", () => {
    expect(venice).toBeDefined();
    expect(venice.category).toBe("apikey");
    expect(venice.transport.baseUrl).toBe("https://api.venice.ai/api/v1/chat/completions");
    expect(venice.alias).toBe("venice");
    expect(venice.aliases).toContain("vn");
  });

  it("enables dynamic model discovery and passthrough", () => {
    expect(venice.passthroughModels).toBe(true);
    expect(venice.modelsFetcher).toMatchObject({
      url: "https://api.venice.ai/api/v1/models",
      type: "openai",
    });
  });

  it("builds into the runtime PROVIDERS map with the openai format default", () => {
    expect(PROVIDERS.venice).toBeDefined();
    expect(PROVIDERS.venice.format).toBe("openai");
    expect(PROVIDERS.venice.baseUrl).toBe("https://api.venice.ai/api/v1/chat/completions");
  });

  it("exposes its seed models (incl. the signature uncensored model)", () => {
    const ids = (PROVIDER_MODELS.venice || []).map((m) => m.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain("venice-uncensored-1-2");
  });

  it("keeps every registry id unique after adding venice", () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
