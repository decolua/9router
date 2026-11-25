import { describe, expect, it, afterEach } from "vitest";
import { getCapabilitiesForModel, setCatalogSource } from "../../open-sse/providers/capabilities.js";

afterEach(() => setCatalogSource(null));

describe(":free suffix normalization", () => {
  it("resolves colon-form seat against dash-form MODEL_CAPABILITIES entry", () => {
    const caps = getCapabilitiesForModel("openrouter", "nvidia/nemotron-3.5-super-vl:free");
    expect(caps.contextWindow).toBe(1048576);
  });

  it("catalog overlay supplies 1M for absent-from-static :free models", () => {
    setCatalogSource({
      getModalities: () => null,
      getLimits: (provider, model) =>
        provider === "kilocode" && model === "baidu/ernie-5.5-flash-preview:free"
          ? { contextWindow: 1024000 }
          : null,
    });
    const caps = getCapabilitiesForModel("kilocode", "baidu/ernie-5.5-flash-preview:free");
    expect(caps.contextWindow).toBe(1024000);
  });

  it("catalog overlay reaches pattern-matched nemotron ultra :free", () => {
    setCatalogSource({
      getModalities: () => null,
      getLimits: (provider, model) =>
        provider === "openrouter" && model === "nvidia/nemotron-3-ultra-550b-a55b:free"
          ? { contextWindow: 1000000 }
          : null,
    });
    const caps = getCapabilitiesForModel("openrouter", "nvidia/nemotron-3-ultra-550b-a55b:free");
    expect(caps.contextWindow).toBe(1000000);
  });
});