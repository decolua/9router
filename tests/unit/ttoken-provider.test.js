import { describe, expect, it } from "vitest";

import ttoken from "../../open-sse/providers/registry/ttoken.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { getDefaultModel } from "../../open-sse/config/providerModels.js";
import { resolveTransport } from "../../open-sse/services/provider.js";
import { parseModel, resolveProviderAlias } from "../../open-sse/services/model.js";

// Host and lane come from a production probe on 2026-11-26 with a real `sk-ttoken-v1-*` Gateway key
// through a local 9Router: /v1/models and /v1/chat/completions answered 200 (JSON and SSE, tools,
// ~208k-token prompts).

describe("ttoken registry entry", () => {
  it("targets api.ttoken.dev on the chat completions lane with bearer auth", () => {
    expect(PROVIDERS.ttoken.format).toBe("openai");
    expect(PROVIDERS.ttoken.baseUrl).toBe("https://api.ttoken.dev/v1/chat/completions");
    expect(PROVIDERS.ttoken.validateUrl).toBe("https://api.ttoken.dev/v1/models");
    // Single lane: no `transports` list, so 9Router translates every client format onto chat.
    expect(PROVIDERS.ttoken.transports).toBeUndefined();
    expect(resolveTransport("ttoken", "claude")).toBeNull();
    expect(ttoken.transport.auth).toEqual({ combined: true, header: "Authorization", scheme: "bearer" });
  });

  it("seeds the generally available chat models without duplicates", () => {
    const ids = ttoken.models.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(PROVIDER_MODELS.ttoken.length).toBe(ids.length);
    expect(getDefaultModel("ttoken")).toBe("deepseek/deepseek-v4.1-flash");
    expect(ids).toContain("ttoken/auto");
    // The uncensored model needs per-account approval on TTOken, so it is not advertised.
    for (const id of ids) expect(id).not.toMatch(/uncensored/);
    expect(ttoken.passthroughModels).toBe(true);
  });

  it("routes vendor-prefixed ids through the ttoken alias", () => {
    expect(resolveProviderAlias("ttoken")).toBe("ttoken");
    expect(parseModel("ttoken/deepseek/deepseek-v4.1-flash")).toEqual({
      provider: "ttoken",
      model: "deepseek/deepseek-v4.1-flash",
      isAlias: false,
      providerAlias: "ttoken",
    });
  });
});
