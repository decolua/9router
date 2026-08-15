import { describe, expect, it, vi, afterEach } from "vitest";

import {
  getRegistryEntry,
  deriveModelsEndpoint,
  fetchViaDerivedEndpoint,
  parseOpenAIStyleModels,
  getStaticProviderModels,
} from "@/lib/providerModels/deriveModelsEndpoint.js";

describe("parseOpenAIStyleModels", () => {
  it("accepts arrays and common envelope shapes", () => {
    expect(parseOpenAIStyleModels([{ id: "a" }])).toEqual([{ id: "a" }]);
    expect(parseOpenAIStyleModels({ data: [{ id: "b" }] })).toEqual([{ id: "b" }]);
    expect(parseOpenAIStyleModels({ models: [{ id: "c" }] })).toEqual([{ id: "c" }]);
    expect(parseOpenAIStyleModels({ results: [{ id: "d" }] })).toEqual([{ id: "d" }]);
    expect(parseOpenAIStyleModels({ something: 1 })).toEqual([]);
  });
});

describe("deriveModelsEndpoint", () => {
  it("returns null for missing entry and non-llm providers", () => {
    expect(deriveModelsEndpoint(null)).toBeNull();
    expect(deriveModelsEndpoint({ id: "x", serviceKinds: ["tts"] })).toBeNull();
  });

  it("prefers modelsFetcher.url over baseUrl derivation", () => {
    const entry = {
      id: "x",
      modelsFetcher: { url: "https://example.com/v1/models", type: "openrouter-free" },
      transport: { baseUrl: "https://example.com/v1/chat/completions" },
    };
    expect(deriveModelsEndpoint(entry)).toEqual({ url: "https://example.com/v1/models", style: "openai" });
  });

  it("skips catalog aggregator fetchers (models.dev) and falls through to baseUrl", () => {
    const entry = {
      id: "mimo-free",
      modelsFetcher: { url: "https://models.dev/api.json", type: "mimo-free" },
      transport: { baseUrl: "https://api.xiaomimimo.com/api/free-ai/openai/chat" },
    };
    // baseUrl doesn't end with a known suffix → not derivable at all
    expect(deriveModelsEndpoint(entry)).toBeNull();
  });

  it("derives /models from an OpenAI-style chat/completions baseUrl", () => {
    const entry = { id: "x", transport: { baseUrl: "https://api.example.com/v1/chat/completions" } };
    expect(deriveModelsEndpoint(entry)).toEqual({ url: "https://api.example.com/v1/models", style: "openai" });
  });

  it("derives /models from an Anthropic-style /messages baseUrl", () => {
    const entry = { id: "x", transport: { baseUrl: "https://api.example.com/anthropic/v1/messages" } };
    expect(deriveModelsEndpoint(entry)).toEqual({ url: "https://api.example.com/anthropic/v1/models", style: "anthropic" });
  });

  it("rejects baseUrls with unresolved placeholders, non-http schemes, and unknown suffixes", () => {
    expect(deriveModelsEndpoint({ id: "x", transport: { baseUrl: "https://api.example.com/{accountId}/v1/chat/completions" } })).toBeNull();
    expect(deriveModelsEndpoint({ id: "x", transport: { baseUrl: "devin://acp/stdio" } })).toBeNull();
    expect(deriveModelsEndpoint({ id: "x", transport: { baseUrl: "https://api.example.com/v1/responses" } })).toBeNull();
    expect(deriveModelsEndpoint({ id: "x" })).toBeNull();
  });

  it("derives endpoints for real registry entries (opencode-go, venice, glm)", () => {
    expect(deriveModelsEndpoint(getRegistryEntry("opencode-go")))
      .toEqual({ url: "https://opencode.ai/zen/go/v1/models", style: "openai" });
    expect(deriveModelsEndpoint(getRegistryEntry("venice")))
      .toEqual({ url: "https://api.venice.ai/api/v1/models", style: "openai" });
    expect(deriveModelsEndpoint(getRegistryEntry("glm")))
      .toEqual({ url: "https://api.z.ai/api/anthropic/v1/models", style: "anthropic" });
  });

  it("returns null for registry entries without a derivable endpoint", () => {
    expect(deriveModelsEndpoint(getRegistryEntry("cloudflare-ai"))).toBeNull(); // {accountId} placeholder
    expect(deriveModelsEndpoint(getRegistryEntry("mimo-free"))).toBeNull(); // models.dev aggregator
    expect(deriveModelsEndpoint(getRegistryEntry("azure"))).toBeNull(); // no baseUrl
    expect(deriveModelsEndpoint(getRegistryEntry("nonexistent-provider"))).toBeNull();
  });
});

describe("fetchViaDerivedEndpoint", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns live models on a successful OpenAI-style fetch with Bearer auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "m1" }, { id: "m2" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchViaDerivedEndpoint(
      { url: "https://api.example.com/v1/models", style: "openai" },
      { provider: "x", apiKey: "sk-test" },
    );

    expect(result).toEqual({ models: [{ id: "m1" }, { id: "m2" }] });
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/models");
    expect(options.headers.Authorization).toBe("Bearer sk-test");
    expect(options.headers["x-api-key"]).toBeUndefined();
  });

  it("sends anthropic-style headers for anthropic endpoints", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: "m1" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchViaDerivedEndpoint(
      { url: "https://api.example.com/v1/models", style: "anthropic" },
      { provider: "x", accessToken: "tok" },
    );

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBe("Bearer tok");
    expect(options.headers["x-api-key"]).toBe("tok");
    expect(options.headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("omits auth headers when the connection has no credentials", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ id: "m1" }],
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchViaDerivedEndpoint(
      { url: "https://example.com/models", style: "openai" },
      { provider: "x" },
    );

    expect(result.models).toEqual([{ id: "m1" }]);
    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
  });

  it("falls back to the static catalog with a warning on HTTP error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchViaDerivedEndpoint(
      { url: "https://api.example.com/v1/models", style: "openai" },
      { provider: "opencode-go", apiKey: "bad" },
    );

    expect(result.warning).toContain("falling back to static catalog");
    expect(result.models).toEqual(getStaticProviderModels("opencode-go"));
    expect(result.models.length).toBeGreaterThan(0);
  });

  it("falls back to the static catalog with a warning on network failure", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchViaDerivedEndpoint(
      { url: "https://api.example.com/v1/models", style: "openai" },
      { provider: "opencode-go", apiKey: "k" },
    );

    expect(result.warning).toContain("falling back to static catalog");
    expect(result.models.length).toBeGreaterThan(0);
  });

  it("falls back when the response parses to an empty list", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ unexpected: "shape" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchViaDerivedEndpoint(
      { url: "https://api.example.com/v1/models", style: "openai" },
      { provider: "opencode-go", apiKey: "k" },
    );

    expect(result.warning).toContain("falling back to static catalog");
    expect(result.models.length).toBeGreaterThan(0);
  });

  it("uses Command Code's public provider models endpoint", () => {
    expect(deriveModelsEndpoint(getRegistryEntry("commandcode"))).toEqual({
      url: "https://api.commandcode.ai/provider/v1/models",
      style: "openai",
    });
    const staticModels = getStaticProviderModels("commandcode");
    expect(staticModels[0]?.id).toBe("deepseek/deepseek-v4-pro");
    expect(staticModels.length).toBe(11);
  });
});
