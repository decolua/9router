import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getExecutor } from "../../open-sse/executors/index.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { parseModel } from "../../open-sse/services/model.js";

describe("JembatanAI provider", () => {
  const entry = REGISTRY.find((e) => e.id === "jembatanai");

  it("is registered as an OpenAI-compatible apikey provider", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(entry.authType).toBe("apikey");
    expect(entry.alias).toBe("jembatanai");
    expect(entry.aliases).toContain("jai");
  });

  it("points at the verified OpenAI-compatible base URL", () => {
    expect(PROVIDERS.jembatanai.baseUrl).toBe("https://freeai.jembatanai.com/v1/chat/completions");
    expect(PROVIDERS.jembatanai.validateUrl).toBe("https://freeai.jembatanai.com/v1/models");
    // transport.format defaults to "openai" via the shared provider default
    expect(PROVIDERS.jembatanai.format).toBe("openai");
  });

  it("declares no provider-wide thinkingFormat so each model resolves its own", () => {
    // The catalogue spans several vendors. A provider-wide thinkingFormat would
    // override capabilities.js and force one wire format (e.g. claude-adaptive)
    // onto every model.
    expect(PROVIDERS.jembatanai.thinkingFormat).toBeUndefined();
  });

  it("enables dynamic model discovery and passthrough", () => {
    expect(entry.passthroughModels).toBe(true);
    expect(entry.modelsFetcher).toMatchObject({
      url: "https://freeai.jembatanai.com/v1/models",
      type: "openai",
    });
  });

  it("exposes a small seed of vendor-prefixed model ids", () => {
    const ids = (PROVIDER_MODELS.jembatanai || []).map((m) => m.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain("anthropic/claude-sonnet-5");
    // JembatanAI ids carry the upstream vendor: vendor/model
    expect(ids.every((id) => id.includes("/"))).toBe(true);
  });

  it("splits the model string at the first slash so the vendor segment stays upstream", () => {
    for (const prefix of ["jembatanai", "jai"]) {
      expect(parseModel(`${prefix}/anthropic/claude-sonnet-5`)).toMatchObject({
        provider: "jembatanai",
        model: "anthropic/claude-sonnet-5",
      });
    }
  });

  it("routes through the shared DefaultExecutor (no custom adapter)", () => {
    expect(getExecutor("jembatanai")).toBeInstanceOf(DefaultExecutor);
  });

  it("resolves per-model capabilities from the shared tables", () => {
    // Vendor-prefixed ids must still reach the canonical family patterns.
    expect(getCapabilitiesForModel("jembatanai", "anthropic/claude-sonnet-5")).toMatchObject({
      vision: true,
      reasoning: true,
      thinkingFormat: "claude-adaptive",
    });
    expect(getCapabilitiesForModel("jembatanai", "openai/gpt-6-luna")).toMatchObject({
      reasoning: true,
      thinkingFormat: "openai",
    });
  });

  it("does not invent capabilities for an uncatalogued model", () => {
    // Vision/reasoning must not be blanket-granted across the provider.
    const caps = getCapabilitiesForModel("jembatanai", "some-vendor/unknown-model-x");
    expect(caps.vision).toBe(false);
    expect(caps.reasoning).toBe(false);
    expect(caps.thinkingFormat).toBeNull();
  });

  it("keeps every registry id and alias unique after adding jembatanai", () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const owners = REGISTRY.filter((e) => [e.id, e.alias, ...(e.aliases || [])].includes("jai"));
    expect(owners.map((e) => e.id)).toEqual(["jembatanai"]);
  });
});
