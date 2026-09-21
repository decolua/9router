import { describe, it, expect } from "vitest";
import {
  ORCAROUTER_ID,
  ORCAROUTER_AUTH_BASE_DEFAULT,
  ORCAROUTER_API_BASE_DEFAULT,
  ORCAROUTER_CONSOLE_URL,
  ORCAROUTER_SEED_MODELS,
  ORCAROUTER_CATALOG_LIMITS,
  resolveAuthBase,
  resolveApiBase,
  isAllowedOrcaOrigin,
  buildAuthorizeUrl,
  buildExchangeUrl,
  buildCatalogUrl,
  normalizeCatalogEntry,
  isTextChatModel,
  supportsModality,
  matchesCapability,
  filterCatalog,
  seedCatalog,
  discoverOrcaRouterModels,
} from "../../open-sse/providers/orcarouterCatalog.js";
import orcarouterRegistry from "../../open-sse/providers/registry/orcarouter.js";
import { PROVIDERS, PROVIDER_MODELS, PROVIDER_OAUTH, PROVIDER_MEDIA } from "../../open-sse/providers/index.js";

// A catalog shaped like the relay's `GET /v1/models` response: vendor-namespaced
// ids plus `supported_endpoint_types` and `architecture.input_modalities`.
const CATALOG = [
  {
    id: "openai/gpt-5.5",
    name: "GPT-5.5",
    context_length: 400000,
    supported_endpoint_types: ["openai", "openai-response"],
    architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
    reasoning: true,
    reasoning_efforts: ["low", "medium", "high", "xhigh"],
  },
  {
    id: "anthropic/claude-opus-4.8",
    name: "Claude Opus 4.8",
    context_length: 1000000,
    supported_endpoint_types: ["anthropic"],
    architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
  },
  {
    id: "deepseek/deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    supported_endpoint_types: ["openai"],
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  },
  {
    id: "google/gemini-3.5-flash",
    name: "Gemini 3.5 Flash",
    supported_endpoint_types: ["gemini"],
    architecture: { input_modalities: ["text", "image", "audio", "video"], output_modalities: ["text"] },
  },
  {
    id: "openai/text-embedding-3-large",
    name: "Text Embedding 3 Large",
    supported_endpoint_types: ["embedding"],
    architecture: { input_modalities: ["text"], output_modalities: ["embedding"] },
  },
  {
    id: "black-forest-labs/flux-1-schnell",
    name: "FLUX 1 Schnell",
    supported_endpoint_types: ["image-generation"],
    architecture: { input_modalities: ["text"], output_modalities: ["image"] },
  },
  {
    id: "openai/sora-2",
    name: "Sora 2",
    supported_endpoint_types: ["openai-video"],
    architecture: { input_modalities: ["text"], output_modalities: ["video"] },
  },
  {
    id: "jina/jina-reranker-v2",
    name: "Jina Reranker v2",
    supported_endpoint_types: ["jina-rerank"],
    architecture: { input_modalities: ["text"], output_modalities: ["text"] },
  },
  // No declared modalities: must fail closed for multimedia entry points.
  { id: "openai/undeclared", name: "Undeclared", supported_endpoint_types: ["openai"] },
];

const idsOf = (models) => models.map((m) => m.id);

describe("orcarouter origins", () => {
  it("keeps auth and inference on different public origins", () => {
    expect(resolveAuthBase({})).toBe(ORCAROUTER_AUTH_BASE_DEFAULT);
    expect(resolveApiBase({})).toBe(ORCAROUTER_API_BASE_DEFAULT);
    expect(ORCAROUTER_AUTH_BASE_DEFAULT).toBe("https://www.orcarouter.ai");
    expect(ORCAROUTER_API_BASE_DEFAULT).toBe("https://api.orcarouter.ai");
  });

  it("never derives one origin from the other", () => {
    const auth = resolveAuthBase({});
    const api = resolveApiBase({});
    expect(new URL(auth).hostname).not.toBe(new URL(api).hostname);
    // The relay comment says /v1 belongs to inference only.
    expect(buildExchangeUrl({ authBase: auth })).toBe("https://www.orcarouter.ai/api/v1/auth/keys");
    expect(buildExchangeUrl({ authBase: auth })).not.toContain("api.orcarouter.ai");
    // The documented mistake must not be produced by our builder.
    expect(buildExchangeUrl({ authBase: auth })).not.toBe("https://api.orcarouter.ai/v1/auth/keys");
  });

  it("prefers explicit overrides over the shared self-hosted fallback", () => {
    expect(resolveAuthBase({ ORCA_BASE_URL: "https://shared.example" })).toBe("https://shared.example");
    expect(resolveApiBase({ ORCA_BASE_URL: "https://shared.example" })).toBe("https://shared.example");
    expect(
      resolveAuthBase({ ORCA_BASE_URL: "https://shared.example", ORCA_AUTH_BASE_URL: "https://auth.example" })
    ).toBe("https://auth.example");
    expect(
      resolveApiBase({ ORCA_BASE_URL: "https://shared.example", ORCA_API_BASE_URL: "https://api.example" })
    ).toBe("https://api.example");
  });

  it("allows HTTPS anywhere and HTTP only on loopback", () => {
    expect(isAllowedOrcaOrigin("https://www.orcarouter.ai")).toBe(true);
    expect(isAllowedOrcaOrigin("http://127.0.0.1:8080")).toBe(true);
    expect(isAllowedOrcaOrigin("http://localhost:3000")).toBe(true);
    expect(isAllowedOrcaOrigin("http://orca.example.com")).toBe(false);
    expect(isAllowedOrcaOrigin("ftp://orca.example.com")).toBe(false);
    expect(isAllowedOrcaOrigin("not a url")).toBe(false);
  });

  it("builds the authorize URL with S256 and an out-of-band callback", () => {
    const url = new URL(
      buildAuthorizeUrl({
        authBase: ORCAROUTER_AUTH_BASE_DEFAULT,
        codeChallenge: "CHALLENGE",
        state: "STATE",
        appName: "9Router",
      })
    );
    expect(url.origin).toBe(ORCAROUTER_AUTH_BASE_DEFAULT);
    expect(url.pathname).toBe("/auth");
    expect(url.searchParams.get("callback_url")).toBe("oob");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toBe("CHALLENGE");
    expect(url.searchParams.get("state")).toBe("STATE");
    expect(url.searchParams.get("app_name")).toBe("9Router");
    expect(url.searchParams.get("scope")).toBe("api");
  });

  it("scopes the catalog request to one capability", () => {
    expect(buildCatalogUrl({ apiBase: ORCAROUTER_API_BASE_DEFAULT })).toBe(
      "https://api.orcarouter.ai/v1/models"
    );
    expect(buildCatalogUrl({ apiBase: ORCAROUTER_API_BASE_DEFAULT, capability: "embedding" })).toBe(
      "https://api.orcarouter.ai/v1/models?capability=embedding"
    );
  });
});

describe("orcarouter catalog parsing", () => {
  it("preserves the vendor/model namespace verbatim", () => {
    const entry = normalizeCatalogEntry({ id: "openai/gpt-5.5" });
    expect(entry.id).toBe("openai/gpt-5.5");
    expect(entry.name).toBe("openai/gpt-5.5");
  });

  it("rejects records without a usable id", () => {
    expect(normalizeCatalogEntry(null)).toBeNull();
    expect(normalizeCatalogEntry({})).toBeNull();
    expect(normalizeCatalogEntry({ id: "   " })).toBeNull();
    expect(normalizeCatalogEntry("openai/gpt-5.5")).toBeNull();
  });

  it("reads both snake_case and camelCase metadata", () => {
    const snake = normalizeCatalogEntry({
      id: "a/b",
      context_length: 1000,
      supported_endpoint_types: ["openai"],
      architecture: { input_modalities: ["text", "image"] },
    });
    const camel = normalizeCatalogEntry({
      id: "a/b",
      contextLength: 1000,
      supportedEndpointTypes: ["openai"],
      inputModalities: ["text", "image"],
    });
    expect(snake.contextLength).toBe(1000);
    expect(camel.contextLength).toBe(1000);
    expect(snake.inputModalities).toEqual(["text", "image"]);
    expect(camel.inputModalities).toEqual(["text", "image"]);
  });
});

describe("orcarouter capability filtering", () => {
  const models = CATALOG.map(normalizeCatalogEntry).filter(Boolean);

  it("caps the seed at the documented verified set", () => {
    expect(idsOf(ORCAROUTER_SEED_MODELS)).toEqual([
      "openai/gpt-5.5",
      "anthropic/claude-opus-4.8",
      "google/gemini-3.5-flash",
      "deepseek/deepseek-v4-pro",
      "orcarouter/auto",
    ]);
  });

  it("keeps the verified GPT-5.5 reasoning ladder intact", () => {
    const gpt = ORCAROUTER_SEED_MODELS.find((m) => m.id === "openai/gpt-5.5");
    expect(gpt.reasoning).toBe(true);
    expect(gpt.reasoningEfforts).toEqual(["low", "medium", "high", "xhigh"]);
    expect(gpt.contextLength).toBe(400000);
    expect(gpt.inputModalities).toContain("image");
  });

  it("selects only text chat models for the chat entry point", () => {
    const chat = filterCatalog(models, { capability: "chat" });
    expect(idsOf(chat)).toContain("openai/gpt-5.5");
    expect(idsOf(chat)).toContain("anthropic/claude-opus-4.8");
    // Media-only endpoint types never leak into a text picker.
    expect(idsOf(chat)).not.toContain("black-forest-labs/flux-1-schnell");
    expect(idsOf(chat)).not.toContain("openai/sora-2");
    expect(idsOf(chat)).not.toContain("jina/jina-reranker-v2");
    expect(idsOf(chat)).not.toContain("openai/text-embedding-3-large");
  });

  it("fails closed for multimodal entry points", () => {
    const image = filterCatalog(models, { capability: "chat", modality: "image" });
    expect(idsOf(image)).toContain("openai/gpt-5.5");
    expect(idsOf(image)).toContain("anthropic/claude-opus-4.8");
    expect(idsOf(image)).toContain("google/gemini-3.5-flash");
    // Text-only chat model dropped.
    expect(idsOf(image)).not.toContain("deepseek/deepseek-v4-pro");
    // Undeclared modalities are a rejection, never an assumption.
    expect(idsOf(image)).not.toContain("openai/undeclared");
    expect(supportsModality({ id: "x" }, "image")).toBe(false);
  });

  it("filters video and rerank strictly by endpoint type", () => {
    expect(idsOf(filterCatalog(models, { capability: "video" }))).toEqual(["openai/sora-2"]);
    expect(idsOf(filterCatalog(models, { capability: "rerank" }))).toEqual(["jina/jina-reranker-v2"]);
    expect(idsOf(filterCatalog(models, { capability: "image" }))).toEqual(["black-forest-labs/flux-1-schnell"]);
    expect(idsOf(filterCatalog(models, { capability: "embedding" }))).toEqual(["openai/text-embedding-3-large"]);
  });

  it("treats a model with neither endpoint types nor output modalities as text", () => {
    expect(isTextChatModel({ id: "x" })).toBe(true);
    expect(matchesCapability({ id: "x" }, "chat")).toBe(true);
  });

  it("filters the seed for the requested entry point", () => {
    // gemini declares audio/video input, the others do not.
    expect(idsOf(seedCatalog({ capability: "chat", modality: "video" }))).toEqual(["google/gemini-3.5-flash"]);
    expect(idsOf(seedCatalog({ capability: "embedding" }))).toEqual([]);
  });
});

describe("orcarouter bounded live discovery", () => {
  const okResponse = (payload) => ({
    ok: true,
    status: 200,
    body: null,
    text: async () => JSON.stringify(payload),
  });

  it("uses the live catalog when it answers, and never mixes in the seed", async () => {
    const result = await discoverOrcaRouterModels({
      apiKey: "sk-orca-fake",
      fetchImpl: async (url) => {
        expect(url).toContain("https://api.orcarouter.ai/v1/models");
        return okResponse({ data: CATALOG });
      },
    });
    expect(result.source).toBe("live");
    expect(result.degraded).toBe(false);
    expect(idsOf(result.models)).toContain("openai/gpt-5.5");
    // The seed-only ids must not survive a successful live discovery.
    expect(idsOf(result.models)).not.toContain("orcarouter/auto");
  });

  it("sends the key as a Bearer header to the inference origin", async () => {
    let seen = null;
    await discoverOrcaRouterModels({
      apiKey: "sk-orca-fake",
      fetchImpl: async (url, init) => {
        seen = { url, init };
        return okResponse({ data: CATALOG });
      },
    });
    expect(seen.init.headers.Authorization).toBe("Bearer sk-orca-fake");
    expect(new URL(seen.url).origin).toBe(ORCAROUTER_API_BASE_DEFAULT);
  });

  it("requests the capability filter from the catalog", async () => {
    let seenUrl = null;
    await discoverOrcaRouterModels({
      apiKey: "sk-orca-fake",
      capability: "embedding",
      fetchImpl: async (url) => {
        seenUrl = url;
        return okResponse({ data: CATALOG });
      },
    });
    expect(seenUrl).toContain("capability=embedding");
  });

  it("narrows the chat catalog by modality and applies it server-side", async () => {
    const seen = [];
    const result = await discoverOrcaRouterModels({
      apiKey: "sk-orca-fake",
      capability: "chat",
      modality: "image",
      fetchImpl: async (url) => {
        seen.push(url);
        return okResponse({ data: CATALOG });
      },
    });
    // The modality is a local restriction: the upstream query stays capability-only
    // so the relay keeps returning its own authoritative list.
    expect(seen[0]).toContain("capability=chat");
    expect(seen[0]).not.toContain("modality=");
    const ids = result.models.map((m) => m.id);
    // Declared image input survives…
    expect(ids).toEqual(expect.arrayContaining([
      "openai/gpt-5.5",
      "anthropic/claude-opus-4.8",
      "google/gemini-3.5-flash",
    ]));
    // …while a text-only chat model is dropped from the multimodal slice.
    expect(ids).not.toContain("deepseek/deepseek-v4-pro");
  });

  it("applies the same strict rule to every declared modality", async () => {
    const fetchImpl = async () => okResponse({ data: CATALOG });
    const audio = await discoverOrcaRouterModels({ apiKey: "sk-orca-fake", capability: "chat", modality: "audio", fetchImpl });
    // Only the Gemini entry declares audio input, so nothing else may appear.
    expect(audio.models.map((m) => m.id)).toEqual(["google/gemini-3.5-flash"]);

    const video = await discoverOrcaRouterModels({ apiKey: "sk-orca-fake", capability: "chat", modality: "video", fetchImpl });
    expect(video.models.map((m) => m.id)).toEqual(["google/gemini-3.5-flash"]);
  });

  it("falls back to the verified seed on every failure mode", async () => {
    const cases = [
      { name: "http error", impl: async () => ({ ok: false, status: 500, text: async () => "" }) },
      { name: "network", impl: async () => { throw new Error("boom"); } },
      { name: "invalid json", impl: async () => ({ ok: true, status: 200, text: async () => "<html>" }) },
      { name: "empty catalog", impl: async () => okResponse({ data: [] }) },
    ];
    for (const c of cases) {
      const result = await discoverOrcaRouterModels({ apiKey: "sk-orca-fake", fetchImpl: c.impl });
      expect(result.source, c.name).toBe("fallback");
      expect(result.degraded, c.name).toBe(true);
      expect(result.ok, c.name).toBe(false);
      expect(idsOf(result.models), c.name).toContain("openai/gpt-5.5");
      expect(idsOf(result.models), c.name).toContain("orcarouter/auto");
    }
  });

  it("falls back rather than calling out without a key or over plain HTTP", async () => {
    const insecure = await discoverOrcaRouterModels({ apiKey: "sk-orca-fake", apiBase: "http://orca.example.com" });
    expect(insecure.source).toBe("fallback");
    expect(insecure.error).toBe("insecure_or_origin");

    const noKey = await discoverOrcaRouterModels({ fetchImpl: async () => okResponse({ data: CATALOG }) });
    expect(noKey.source).toBe("fallback");
    expect(noKey.error).toBe("missing_api_key");
  });

  it("bounds the request with a timeout", async () => {
    const hang = async (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    const result = await discoverOrcaRouterModels({ apiKey: "sk-orca-fake", fetchImpl: hang, timeoutMs: 20 });
    expect(result.source).toBe("fallback");
    expect(result.error).toBe("timeout");
    expect(ORCAROUTER_CATALOG_LIMITS.timeoutMs).toBeGreaterThan(0);
  });

  it("bounds the number of accepted items", async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      id: `vendor/model-${i}`,
      supported_endpoint_types: ["openai"],
    }));
    const result = await discoverOrcaRouterModels({
      apiKey: "sk-orca-fake",
      maxItems: 5,
      fetchImpl: async () => okResponse({ data: many }),
    });
    expect(result.models).toHaveLength(5);
  });

  it("accepts both the {data:[]} and bare-array catalog shapes", async () => {
    const bare = await discoverOrcaRouterModels({
      apiKey: "sk-orca-fake",
      fetchImpl: async () => okResponse(CATALOG),
    });
    expect(bare.source).toBe("live");
    expect(idsOf(bare.models)).toContain("openai/gpt-5.5");
  });
});

describe("orcarouter provider registration", () => {
  it("registers as a first-class named provider with both auth modes", () => {
    expect(orcarouterRegistry.id).toBe(ORCAROUTER_ID);
    expect(orcarouterRegistry.display.name).toBe("OrcaRouter");
    expect(orcarouterRegistry.authModes).toEqual(["apikey", "oauth"]);
    expect(orcarouterRegistry.hasOAuth).toBe(true);
    // category "oauth" is what puts it in the dashboard's OAuth group and
    // unlocks the dual-auth button pair.
    expect(orcarouterRegistry.category).toBe("oauth");
  });

  it("routes inference at the relay /v1 base and auth at the www origin", () => {
    expect(PROVIDERS[ORCAROUTER_ID].baseUrl).toBe("https://api.orcarouter.ai/v1/chat/completions");
    expect(PROVIDERS[ORCAROUTER_ID].validateUrl).toBe("https://api.orcarouter.ai/v1/models");
    expect(PROVIDER_OAUTH[ORCAROUTER_ID].authorizeUrl).toBe("https://www.orcarouter.ai/auth");
    expect(PROVIDER_OAUTH[ORCAROUTER_ID].tokenUrl).toBe("https://www.orcarouter.ai/api/v1/auth/keys");
    // The relay's /v1 is not an auth path.
    expect(PROVIDER_OAUTH[ORCAROUTER_ID].tokenUrl).not.toContain("api.orcarouter.ai");
  });

  it("exposes a verified cold-start seed through the model registry", () => {
    expect(PROVIDER_MODELS.orca).toHaveLength(ORCAROUTER_SEED_MODELS.length);
    expect(PROVIDER_MODELS.orca.map((m) => m.id)).toContain("openai/gpt-5.5");
    expect(orcarouterRegistry.passthroughModels).toBe(true);
  });

  it("declares the service kinds the relay can serve", () => {
    expect(PROVIDER_MEDIA[ORCAROUTER_ID].serviceKinds).toEqual(["llm", "embedding", "image", "video"]);
    expect(PROVIDER_MEDIA[ORCAROUTER_ID].embeddingConfig.baseUrl).toBe("https://api.orcarouter.ai/v1/embeddings");
    expect(PROVIDER_MEDIA[ORCAROUTER_ID].imageConfig.baseUrl).toBe("https://api.orcarouter.ai/v1/images/generations");
  });

  it("points users at the revocation console", () => {
    expect(ORCAROUTER_CONSOLE_URL).toBe("https://www.orcarouter.ai/console/authorized-apps");
  });

  it("does not require a client secret anywhere in the provider definition", () => {
    const serialized = JSON.stringify(PROVIDER_OAUTH[ORCAROUTER_ID]);
    expect(serialized).not.toContain("clientSecret");
    expect(serialized.toLowerCase()).not.toContain("client_secret");
  });
});
