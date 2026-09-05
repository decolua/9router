import { beforeEach, describe, expect, it, vi } from "vitest";

const { connectionsMock, customModelsMock, fetchMock } = vi.hoisted(() => ({
  connectionsMock: vi.fn(),
  customModelsMock: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: connectionsMock,
  getCombos: vi.fn(async () => []),
  getCustomModels: customModelsMock,
  getModelAliases: vi.fn(async () => ({})),
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => ({})),
}));

vi.mock("@/sse/services/tokenRefresh", () => ({
  updateProviderCredentials: vi.fn(async () => {}),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(() => null),
}));

const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

const PROVIDER_ID = "openai-compatible-chat-11111111";

const connection = {
  provider: PROVIDER_ID,
  isActive: true,
  apiKey: "sk-test",
  providerSpecificData: { prefix: "hn", apiType: "chat", baseUrl: "https://api.example.com/v1" },
};

// The upstream catalog the provider's own /models endpoint advertises.
const UPSTREAM = ["keep-me", "drop-me-1", "drop-me-2"];

function idsFor(models) {
  return models.filter(m => m.id.startsWith("hn/")).map(m => m.id.slice(3));
}

beforeEach(() => {
  vi.clearAllMocks();
  global.fetch = fetchMock;
  connectionsMock.mockResolvedValue([connection]);
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ data: UPSTREAM.map(id => ({ id })) }),
  });
});

describe("#3115 curated custom-provider model list wins over the live upstream catalog", () => {
  it("lists only the curated models and never hits the upstream /models endpoint", async () => {
    customModelsMock.mockResolvedValue([{ providerAlias: "hn", id: "keep-me", type: "llm" }]);

    const data = await buildModelsList(["llm"]);

    expect(idsFor(data)).toEqual(["keep-me"]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still falls back to the live catalog when nothing is curated", async () => {
    customModelsMock.mockResolvedValue([]);

    const data = await buildModelsList(["llm"]);

    expect(idsFor(data).sort()).toEqual([...UPSTREAM].sort());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("ignores curated models belonging to a different provider", async () => {
    customModelsMock.mockResolvedValue([{ providerAlias: "other", id: "not-mine", type: "llm" }]);

    const data = await buildModelsList(["llm"]);

    expect(idsFor(data).sort()).toEqual([...UPSTREAM].sort());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps honouring skipDynamicFetch", async () => {
    customModelsMock.mockResolvedValue([]);

    const data = await buildModelsList(["llm"], { skipDynamicFetch: true });

    expect(idsFor(data)).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
