import { describe, expect, it } from "vitest";

import { aggregateComboCapabilities, getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

// A combo's limits are the conservative aggregate of its members: ctx = min,
// maxOutput = max. Resolving those members needs the synced model catalog, which
// is server-only (it reads a file), so the browser bundle falls back to the
// generic patterns. The dashboard computed its badges there and under-reported:
// /v1/models and pi-settings (both server-side) said 1M while the badge said 200k.
//
// resolveCaps lets a caller hand in the server's answer. It must only override
// what it carries — the local tables still own tools/pdf/audio/video/thinking*.
const GLM53_FED = { vision: true, search: false, reasoning: true, contextWindow: 1_000_000, maxOutput: 131_072 };

describe("aggregateComboCapabilities: resolveCaps override", () => {
  const models = ["glm-cn/glm-5.3", "deepseek-v4.1-flash"];

  it("falls back to the pattern default without a resolver", () => {
    const caps = aggregateComboCapabilities(models);
    expect(caps.contextWindow).toBe(1_000_000);
  });

  it("uses the fed limits when a resolver supplies them", () => {
    // Feed a value the local tables don't have, so the assertion proves the override.
    const fed = { ...GLM53_FED, contextWindow: 640_000 };
    const resolver = (fullId) => (fullId === "glm-cn/glm-5.3" ? fed : null);
    const caps = aggregateComboCapabilities(models, null, resolver);
    expect(aggregateComboCapabilities(models).contextWindow).not.toBe(640_000);
    expect(caps.contextWindow).toBe(640_000);
  });

  it("keeps the fields the override does not carry", () => {
    const plain = aggregateComboCapabilities(models);
    const fed = aggregateComboCapabilities(models, null, (id) => (id === "glm-cn/glm-5.3" ? GLM53_FED : null));
    // The override carries no tools/pdf/thinking fields, so those must be unchanged.
    for (const field of ["tools", "pdf", "audioInput", "videoInput", "imageOutput", "audioOutput", "thinkingFormat"]) {
      expect(fed[field]).toEqual(plain[field]);
    }
  });

  it("still applies the conservative rule across members", () => {
    const resolver = (fullId) => (fullId === "glm-cn/glm-5.3" ? GLM53_FED : null);
    const caps = aggregateComboCapabilities(models, null, resolver);
    // Only glm-5.3 was fed 1M; deepseek-v4.1-flash resolves locally to 1M, so min stays 1M.
    // Feeding a *smaller* value for one member must pull the aggregate down.
    const smaller = aggregateComboCapabilities(models, null, (id) => (id === "glm-cn/glm-5.3" ? { ...GLM53_FED, contextWindow: 64_000 } : null));
    expect(smaller.contextWindow).toBe(64_000);
    expect(caps.maxOutput).toBe(384_000); // max across members, from deepseek
  });

  it("passes the resolver into nested combos", () => {
    const lookup = {
      zap: ["deepseek-v4.1-flash", "glm-cn/glm-5.3-flash"],
      "deepseek-v4.1-flash": ["cmc/deepseek/deepseek-v4.1-flash", "ocg/deepseek-v4.1-flash"],
    };
    const seen = [];
    const resolver = (fullId) => { seen.push(fullId); return fullId === "glm-cn/glm-5.3-flash" ? { contextWindow: 1_000_000 } : null; };
    aggregateComboCapabilities(lookup.zap, lookup, resolver);
    // The nested combo's own members were resolved with the same resolver.
    expect(seen).toContain("cmc/deepseek/deepseek-v4.1-flash");
    expect(seen).toContain("ocg/deepseek-v4.1-flash");
  });

  it("leaves the plain two-argument call unchanged", () => {
    const caps = aggregateComboCapabilities(["kimi/kimi-k3"], null);
    expect(caps).toEqual(aggregateComboCapabilities(["kimi/kimi-k3"]));
    expect(caps.contextWindow).toBe(getCapabilitiesForModel("kimi", "kimi-k3").contextWindow);
  });

  it("claude-haiku-5-5 combo: 1M only through the provider-alias resolver", () => {
    // Both seats are 1M in their provider tables (opencode-go/commandcode entries),
    // but a bare `ocg/`-style alias resolves to 200k without the resolver: null
    // provider falls to the global *claude*haiku* pattern. The server passes
    // comboSeatCapabilities (alias → provider id); the dashboard does not.
    const seats = ["ocg/claude-haiku-5-5", "cmc/claude-haiku-5-5"];
    const seatCaps = (fullId) => {
      const slash = fullId.indexOf("/");
      if (slash <= 0) return null;
      const providerId = { ocg: "opencode-go", cmc: "commandcode" }[fullId.slice(0, slash)] || fullId.slice(0, slash);
      return getCapabilitiesForModel(providerId, fullId.slice(slash + 1));
    };
    expect(aggregateComboCapabilities(seats).contextWindow).toBe(200_000);
    expect(aggregateComboCapabilities(seats, null, seatCaps).contextWindow).toBe(1_000_000);
  });
});
