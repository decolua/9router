import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connections: [],
  fetch: vi.fn(),
  proxy: vi.fn(async () => ({})),
}));
vi.mock("@/models", () => ({
  getProviderConnectionById: vi.fn(async (id) => mocks.connections.find(connection => connection.id === id)),
}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => mocks.connections),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: mocks.proxy }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: mocks.fetch }));

import { GET, clearProviderModelListCache } from "../../src/app/api/providers/[id]/models/route.js";
import { buildModelsList } from "../../src/app/api/v1/models/route.js";
import { clearCohereCatalog } from "../../open-sse/services/cohereModels.js";
import { clearPollinationsCatalog } from "../../open-sse/services/pollinationsModels.js";

beforeEach(() => {
  vi.clearAllMocks();
  clearProviderModelListCache();
  clearCohereCatalog();
  clearPollinationsCatalog();
  mocks.connections = ["cohere", "pollinations"].map(provider => ({
    id: provider, provider, apiKey: provider === "pollinations" ? "sk_fixture" : "cohere-fixture",
    isActive: true, providerSpecificData: {},
  }));
  mocks.fetch.mockImplementation(async (url) => {
    if (String(url).startsWith("https://api.cohere.com/v1/models")) return Response.json({ models: [
      { name: "command-a-plus-05-2026", endpoints: ["chat"], context_length: 128000 },
      { name: "embed-v4.0", endpoints: ["embed"] },
      { name: "cohere-transcribe-03-2026", endpoints: ["transcribe"] },
    ] });
    if (String(url) === "https://gen.pollinations.ai/v1/models") return Response.json({ data: [
      { id: "community/person/vision", category: "text", paid_only: false, pricing: { promptTextTokens: "0", completionTextTokens: "0" }, input_modalities: ["text", "image"], supported_endpoints: ["/v1/chat/completions"] },
      { id: "openai/text-embedding-3-small", category: "embedding", paid_only: false, pricing: { promptTextTokens: "0" }, supported_endpoints: ["/v1/embeddings"] },
      { id: "typesafe/jev-1.14", category: "decision", paid_only: false, pricing: { request: 0 }, supported_endpoints: ["/alpha/decisions"] },
      { id: "openai/paid-chat", category: "text", paid_only: true, supported_endpoints: ["/v1/chat/completions"] },
      { id: "quest/chat", category: "text", paid_only: false, pricing: { promptTextTokens: "0.001" }, supported_endpoints: ["/v1/chat/completions"] },
      { id: "unknown/chat", category: "text", paid_only: false, supported_endpoints: ["/v1/chat/completions"] },
    ] });
    throw new Error(`Unexpected upstream: ${url}`);
  });
});

describe("free-tier model population", () => {
  it("automatically publishes each supported kind without manually enabling models", async () => {
    const models = await buildModelsList(["llm", "embedding", "stt", "systemone"]);
    expect(models.filter(model => ["cohere", "pollinations"].includes(model.owned_by)).map(model => model.id).sort()).toEqual([
      "cohere/cohere-transcribe-03-2026", "cohere/command-a-plus-05-2026", "cohere/embed-v4.0",
      "pollinations/community/person/vision", "pollinations/openai/text-embedding-3-small", "pollinations/typesafe/jev-1.14",
    ]);
    expect(models.find(model => model.id === "pollinations/community/person/vision").capabilities.vision).toBe(true);
    const embeddings = await buildModelsList(["embedding"]);
    expect(embeddings.filter(model => ["cohere", "pollinations"].includes(model.owned_by)).map(model => model.id).sort()).toEqual([
      "cohere/embed-v4.0", "pollinations/openai/text-embedding-3-small",
    ]);
  });

  it("returns free typed catalog rows to the dashboard with connection proxy settings", async () => {
    const proxy = { connectionProxyEnabled: true, connectionProxyUrl: "http://proxy.fixture:8080", strictProxy: true };
    mocks.proxy.mockResolvedValueOnce(proxy);
    const response = await GET(new Request("http://router/api/providers/pollinations/models"), { params: Promise.resolve({ id: "pollinations" }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.models.map(model => model.kind)).toEqual(["llm", "embedding", "systemone"]);
    expect(body.models.some(model => model.id === "openai/paid-chat")).toBe(false);
    expect(body.suggestedModels.map(model => model.id)).toEqual(["quest/chat", "unknown/chat"]);
    expect(mocks.fetch.mock.calls[0][2]).toEqual(proxy);
  });

  it("discovers the public Pollinations catalog without a saved connection", async () => {
    mocks.connections = [];
    const response = await GET(new Request("http://router/api/providers/pollinations/models"), { params: Promise.resolve({ id: "pollinations" }) });
    expect(response.status).toBe(200);
    const { models } = await response.json();
    expect(models.map(model => model.id)).toEqual([
      "community/person/vision", "openai/text-embedding-3-small", "typesafe/jev-1.14",
    ]);
    expect(mocks.fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it.each([false, true])("surfaces upstream discovery failures with saved connection: %s", async (connected) => {
    if (!connected) mocks.connections = [];
    mocks.fetch.mockResolvedValueOnce(Response.json({ error: { message: "Catalog unavailable" } }, { status: 503 }));
    const response = await GET(new Request("http://router/api/providers/pollinations/models"), { params: Promise.resolve({ id: "pollinations" }) });
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe("Catalog unavailable");
  });
  it("does not substitute seeded models for a successful empty account catalog", async () => {
    mocks.connections = mocks.connections.filter(connection => connection.provider === "cohere");
    mocks.fetch.mockResolvedValueOnce(Response.json({ models: [] }));
    const models = await buildModelsList(["llm", "embedding", "stt"]);
    expect(models.filter(model => model.owned_by === "cohere")).toEqual([]);
  });
});
