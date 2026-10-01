import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";

describe("Token Harbor provider", () => {
  const entry = REGISTRY.find((e) => e.id === "tokenharbor");

  it("is registered as an OpenAI-compatible apikey provider", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(entry.authType).toBe("apikey");
    expect(entry.alias).toBe("tokenharbor");
    expect(entry.aliases).toContain("th");
  });

  it("points at the verified OpenAI-compatible base URL", () => {
    expect(PROVIDERS.tokenharbor.baseUrl).toBe("https://tokenharbor.ai/v1/chat/completions");
    expect(PROVIDERS.tokenharbor.validateUrl).toBe("https://tokenharbor.ai/v1/models");
    // transport.format defaults to "openai" via the shared provider default
    expect(PROVIDERS.tokenharbor.format).toBe("openai");
  });

  it("declares no provider-wide thinkingFormat so each model resolves its own", () => {
    // Token Harbor forwards bodies verbatim. A provider-wide thinkingFormat
    // would override capabilities.js and force one wire format (e.g.
    // claude-adaptive) onto every model, which an OpenAI endpoint rejects.
    expect(PROVIDERS.tokenharbor.thinkingFormat).toBeUndefined();
  });

  it("enables dynamic model discovery and passthrough", () => {
    expect(entry.passthroughModels).toBe(true);
    expect(entry.modelsFetcher).toMatchObject({
      url: "https://tokenharbor.ai/v1/models",
      type: "openai",
    });
  });

  it("exposes a small seed of bare (unprefixed) model ids", () => {
    const ids = (PROVIDER_MODELS.tokenharbor || []).map((m) => m.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain("claude-opus-5.5");
    // Token Harbor does not prefix ids by upstream vendor
    expect(ids.every((id) => !id.includes("/"))).toBe(true);
  });

  it("routes through the shared DefaultExecutor (no custom adapter)", () => {
    expect(getExecutor("tokenharbor")).toBeInstanceOf(DefaultExecutor);
  });

  it("resolves per-model capabilities from the shared tables", () => {
    // Bare ids must still reach the canonical family patterns.
    expect(getCapabilitiesForModel("tokenharbor", "claude-opus-5.5")).toMatchObject({
      vision: true,
      reasoning: true,
      thinkingFormat: "claude-adaptive",
    });
    expect(getCapabilitiesForModel("tokenharbor", "gpt-6-astra")).toMatchObject({
      reasoning: true,
      thinkingFormat: "openai",
    });
  });

  it("does not invent capabilities for an uncatalogued model", () => {
    // Vision/reasoning must not be blanket-granted across the provider.
    const caps = getCapabilitiesForModel("tokenharbor", "some-unknown-model-x");
    expect(caps.vision).toBe(false);
    expect(caps.reasoning).toBe(false);
    expect(caps.thinkingFormat).toBeNull();
  });

  it("keeps every registry id unique after adding tokenharbor", () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
