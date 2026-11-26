import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getEmbeddingAdapter } from "../../open-sse/handlers/embeddingProviders/index.js";
import { handleEmbeddingsCore } from "../../open-sse/handlers/embeddingsCore.js";
import { AI_PROVIDERS, getProvidersByKind } from "../../src/shared/constants/providers.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import ollamaLocalRegistry from "../../open-sse/providers/registry/ollama-local.js";

const VALID_EMBEDDING_RESPONSE = {
  object: "list",
  data: [
    {
      object: "embedding",
      index: 0,
      embedding: [0.1, 0.2, 0.3],
    },
  ],
  model: "nomic-embed-text",
  usage: { prompt_tokens: 4, total_tokens: 4 },
};

function makeProviderResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeOptions(overrides = {}) {
  return {
    body: { model: "nomic-embed-text", input: "Hello world" },
    modelInfo: { provider: "ollama-local", model: "nomic-embed-text" },
    credentials: {},
    ...overrides,
  };
}

describe("Ollama Local Embeddings Integration", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("wires ollama-local into media-providers embedding (serviceKind, adapter, config, models)", () => {
    const provider = AI_PROVIDERS["ollama-local"];
    expect(provider).toBeDefined();
    expect(provider.serviceKinds).toContain("embedding");
    expect(provider.serviceKinds).toContain("llm");
    expect(provider.serviceKinds).toContain("systemone");

    expect(provider.embeddingConfig).toBeDefined();
    expect(provider.embeddingConfig.baseUrl).toBe("http://localhost:11434/v1/embeddings");
    expect(provider.embeddingConfig.path).toBe("/v1/embeddings");

    const adapter = getEmbeddingAdapter("ollama-local");
    expect(adapter).toBeTruthy();
    expect(typeof adapter.buildUrl).toBe("function");
    expect(typeof adapter.buildHeaders).toBe("function");
    expect(typeof adapter.buildBody).toBe("function");

    const embeddingProviders = getProvidersByKind("embedding");
    expect(embeddingProviders.some((p) => p.id === "ollama-local")).toBe(true);

    const embeddingModels = (PROVIDER_MODELS["ollama-local"] || ollamaLocalRegistry.models).filter(
      (m) => m.kind === "embedding"
    );
    expect(embeddingModels.length).toBeGreaterThanOrEqual(14);

    const modelIds = new Set(embeddingModels.map((m) => m.id));
    expect(modelIds.has("nomic-embed-text")).toBe(true);
    expect(modelIds.has("nomic-embed-text-v2-moe")).toBe(true);
    expect(modelIds.has("qwen3-embedding")).toBe(true);
    expect(modelIds.has("qwen3-embedding:8b")).toBe(true);
    expect(modelIds.has("bge-m3")).toBe(true);
    expect(modelIds.has("bge-large")).toBe(true);
    expect(modelIds.has("mxbai-embed-large")).toBe(true);
    expect(modelIds.has("embeddinggemma")).toBe(true);
    expect(modelIds.has("embeddinggemma-2")).toBe(true);
    expect(modelIds.has("all-minilm")).toBe(true);
    expect(modelIds.has("snowflake-arctic-embed")).toBe(true);
    expect(modelIds.has("snowflake-arctic-embed2")).toBe(true);
    expect(modelIds.has("granite-embedding")).toBe(true);
    expect(modelIds.has("paraphrase-multilingual")).toBe(true);
    expect(modelIds.has("laya")).toBe(true);
  });

  it("routes embeddings to default host http://localhost:11434/v1/embeddings", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    const result = await handleEmbeddingsCore(makeOptions());

    expect(result.success).toBe(true);
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:11434/v1/embeddings",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "nomic-embed-text", input: "Hello world", encoding_format: "float" }),
      })
    );
  });

  it("normalizes custom host URLs cleanly (handles trailing slashes, /v1, and /v1/embeddings)", async () => {
    const adapter = getEmbeddingAdapter("ollama-local");

    expect(adapter.buildUrl("nomic-embed-text", {})).toBe("http://localhost:11434/v1/embeddings");
    expect(adapter.buildUrl("nomic-embed-text", { providerSpecificData: { baseUrl: "http://192.168.1.100:11434" } })).toBe("http://192.168.1.100:11434/v1/embeddings");
    expect(adapter.buildUrl("nomic-embed-text", { providerSpecificData: { baseUrl: "http://192.168.1.100:11434///" } })).toBe("http://192.168.1.100:11434/v1/embeddings");
    expect(adapter.buildUrl("nomic-embed-text", { providerSpecificData: { baseUrl: "http://192.168.1.100:11434/v1" } })).toBe("http://192.168.1.100:11434/v1/embeddings");
    expect(adapter.buildUrl("nomic-embed-text", { providerSpecificData: { baseUrl: "http://192.168.1.100:11434/v1/embeddings" } })).toBe("http://192.168.1.100:11434/v1/embeddings");
  });

  it("attaches Authorization header when apiKey is supplied for authenticated proxies", async () => {
    const adapter = getEmbeddingAdapter("ollama-local");

    expect(adapter.buildHeaders({})).toEqual({ "Content-Type": "application/json" });
    expect(adapter.buildHeaders({ apiKey: "ollama-secret" })).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer ollama-secret",
    });
  });

  it("handles dimensions parameter properly when provided", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(makeProviderResponse(VALID_EMBEDDING_RESPONSE));

    await handleEmbeddingsCore(makeOptions({
      body: { model: "nomic-embed-text", input: "Hello world", dimensions: 512 },
    }));

    const [, init] = vi.mocked(fetch).mock.calls[0];
    const sent = JSON.parse(init.body);
    expect(sent.dimensions).toBe(512);
  });
});
