import { afterEach, describe, expect, it, vi } from "vitest";

// #4618: models behind a user-defined openai-compatible node always published the
// 200K DEFAULT_CAPABILITIES window. /v1/models now publishes the runtime window the
// node itself reports (vLLM max_model_len, OpenRouter-style context_length, LM Studio
// loaded_context_length from its native /api/v0/models).

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
}));

vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => ({})),
}));

const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

const PROVIDER = "openai-compatible-chat-4618";

function useNode(baseUrl) {
  db.getProviderConnections.mockResolvedValue([{
    id: 1,
    provider: PROVIDER,
    isActive: true,
    apiKey: "test-key",
    providerSpecificData: { baseUrl, prefix: "local" },
  }]);
}

function stubFetch(routes) {
  const fetchMock = vi.fn(async (url) => {
    const body = routes[url];
    if (body === undefined) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => body };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/v1/models context for openai-compatible nodes (#4618)", () => {
  it("publishes LM Studio's loaded window from /api/v0/models", async () => {
    useNode("http://lmstudio-a:1234/v1");
    stubFetch({
      "http://lmstudio-a:1234/v1/models": { data: [{ id: "inkling-2-mini", object: "model" }, { id: "opaque-idle", object: "model" }] },
      "http://lmstudio-a:1234/api/v0/models": { data: [
        { id: "inkling-2-mini", state: "loaded", max_context_length: 1048576, loaded_context_length: 131072 },
        { id: "opaque-idle", state: "not-loaded", max_context_length: 262144 },
      ] },
    });

    const models = await buildModelsList(["llm"]);
    const loaded = models.find((m) => m.id === "local/inkling-2-mini");
    const idle = models.find((m) => m.id === "local/opaque-idle");

    expect(loaded.context_length).toBe(131072);
    expect(loaded.capabilities?.contextWindow ?? 131072).toBe(131072);
    // Not loaded: no runtime window, so the previous fallback applies (never the trained max).
    expect(idle.context_length).toBe(200000);
  });

  it("reads a vLLM-style max_model_len without probing /api/v0", async () => {
    useNode("http://vllm-b:8000/v1");
    const fetchMock = stubFetch({
      "http://vllm-b:8000/v1/models": { data: [{ id: "served", object: "model", max_model_len: 65536 }] },
    });

    const models = await buildModelsList(["llm"]);

    expect(models.find((m) => m.id === "local/served").context_length).toBe(65536);
    expect(fetchMock.mock.calls.map(([u]) => u)).not.toContain("http://vllm-b:8000/api/v0/models");
  });

  it("keeps the previous fallback when the node reports nothing", async () => {
    useNode("http://plain-c:9000/v1");
    stubFetch({ "http://plain-c:9000/v1/models": { data: [{ id: "opaque-model", object: "model" }] } });

    const models = await buildModelsList(["llm"]);

    expect(models.find((m) => m.id === "local/opaque-model").context_length).toBe(200000);
  });

  it("does not re-probe /api/v0 on a host that lacks it", async () => {
    useNode("http://plain-d:9000/v1");
    const fetchMock = stubFetch({ "http://plain-d:9000/v1/models": { data: [{ id: "m", object: "model" }] } });

    await buildModelsList(["llm"]);
    await buildModelsList(["llm"]);

    const probes = fetchMock.mock.calls.filter(([u]) => u === "http://plain-d:9000/api/v0/models");
    expect(probes).toHaveLength(1);
  });
});
