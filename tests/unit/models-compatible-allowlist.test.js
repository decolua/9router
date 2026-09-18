import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn().mockResolvedValue([]),
  getCustomModels: vi.fn().mockResolvedValue([]),
  getModelAliases: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn().mockResolvedValue({}),
}));

vi.mock("open-sse/services/kiroModels.js", () => ({ resolveKiroModels: vi.fn() }));
vi.mock("open-sse/services/kimchiModels.js", () => ({ resolveKimchiModels: vi.fn() }));
vi.mock("open-sse/services/qoderModels.js", () => ({ resolveQoderModels: vi.fn() }));
vi.mock("open-sse/services/copilotModels.js", () => ({ resolveCopilotModels: vi.fn() }));
vi.mock("open-sse/services/clinepassModels.js", () => ({ resolveClinepassModels: vi.fn() }));
vi.mock("open-sse/services/grokCliModels.js", () => ({ resolveGrokCliModels: vi.fn() }));
vi.mock("open-sse/services/cursorModels.js", () => ({ resolveCursorModels: vi.fn() }));
vi.mock("open-sse/shared/zedAuth.js", () => ({ resolveZedModels: vi.fn() }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn().mockResolvedValue({}) }));

vi.mock("@/models", () => ({
  getProviderConnectionById: vi.fn(),
}));

import { buildModelsList } from "@/app/api/v1/models/route.js";
import { GET as getProviderModels } from "@/app/api/providers/[id]/models/route.js";
import { getProviderConnections, getCustomModels, getModelAliases } from "@/lib/localDb";
import { getProviderConnectionById } from "@/models";

describe("buildModelsList - Custom Compatible Provider Allowlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("TEST A: OpenAI-compatible provider with explicit custom model stored under providerId exposes only that model, ignoring upstream /models", async () => {
    getProviderConnections.mockResolvedValue([
      {
        id: "conn-stepfun",
        provider: "openai-compatible-stepfun",
        apiKey: "sk-test",
        isActive: true,
        providerSpecificData: {
          baseUrl: "https://api.stepfun.com/v1",
          prefix: "stepplan",
        },
      },
    ]);

    // Dashboard persists with providerStorageAlias = isCompatible ? providerId : providerAlias
    getCustomModels.mockResolvedValue([
      {
        id: "step-3.7-flash",
        name: "Step 3.7 Flash",
        providerAlias: "openai-compatible-stepfun",
        type: "llm",
      },
    ]);

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "step-3.5-flash" },
          { id: "step-3.5-flash-2603" },
          { id: "step-3.7-flash" },
        ],
      }),
    });

    const models = await buildModelsList(["llm"]);
    const modelIds = models.map((m) => m.id);

    expect(modelIds).toEqual(["stepplan/step-3.7-flash"]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("TEST B: OpenAI-compatible provider with no Available Models returns ZERO models and does not fetch upstream", async () => {
    getProviderConnections.mockResolvedValue([
      {
        id: "conn-empty",
        provider: "openai-compatible-empty",
        apiKey: "sk-test",
        isActive: true,
        providerSpecificData: {
          baseUrl: "https://api.empty.com/v1",
          prefix: "emptyprov",
        },
      },
    ]);

    getCustomModels.mockResolvedValue([]);
    getModelAliases.mockResolvedValue({});

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: "unwanted-model-1" }, { id: "unwanted-model-2" }],
      }),
    });

    const models = await buildModelsList(["llm"]);
    const compatibleModels = models.filter((m) => m.id.startsWith("emptyprov/"));

    expect(compatibleModels).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("TEST C: Anthropic-compatible provider exposes only explicitly configured custom models stored under providerId", async () => {
    getProviderConnections.mockResolvedValue([
      {
        id: "conn-anthropic-custom",
        provider: "anthropic-compatible-minimax",
        apiKey: "sk-test",
        isActive: true,
        providerSpecificData: {
          baseUrl: "https://api.minimax.chat/v1",
          prefix: "minimax-custom",
        },
      },
    ]);

    getCustomModels.mockResolvedValue([
      {
        id: "MiniMax-Text-01",
        providerAlias: "anthropic-compatible-minimax",
        type: "llm",
      },
    ]);

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: "MiniMax-Text-01" }, { id: "MiniMax-VL-01" }, { id: "MiniMax-Speech" }],
      }),
    });

    const models = await buildModelsList(["llm"]);
    const modelIds = models.map((m) => m.id);

    expect(modelIds).toEqual(["minimax-custom/MiniMax-Text-01"]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("TEST D: Legacy model aliases using providerId target remain exposed under output prefix", async () => {
    getProviderConnections.mockResolvedValue([
      {
        id: "conn-legacy",
        provider: "openai-compatible-legacy",
        apiKey: "sk-test",
        isActive: true,
        providerSpecificData: {
          baseUrl: "https://api.legacy.com/v1",
          prefix: "legacyprov",
        },
      },
    ]);

    getCustomModels.mockResolvedValue([]);
    getModelAliases.mockResolvedValue({
      "my-alias": "openai-compatible-legacy/legacy-model-v1",
    });

    const models = await buildModelsList(["llm"]);
    const modelIds = models.map((m) => m.id);

    expect(modelIds).toEqual(["legacyprov/legacy-model-v1"]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("TEST D2 (Backwards compatibility): Older custom models stored under display prefix remain supported", async () => {
    getProviderConnections.mockResolvedValue([
      {
        id: "conn-prefix-storage",
        provider: "openai-compatible-old",
        apiKey: "sk-test",
        isActive: true,
        providerSpecificData: {
          baseUrl: "https://api.old.com/v1",
          prefix: "oldprefix",
        },
      },
    ]);

    getCustomModels.mockResolvedValue([
      {
        id: "old-custom-model",
        providerAlias: "oldprefix",
        type: "llm",
      },
    ]);

    const models = await buildModelsList(["llm"]);
    const modelIds = models.map((m) => m.id);

    expect(modelIds).toEqual(["oldprefix/old-custom-model"]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("TEST E: Import discovery endpoint /api/providers/[id]/models continues to query upstream /models for custom providers", async () => {
    getProviderConnectionById.mockResolvedValue({
      id: "conn-stepfun-import",
      provider: "openai-compatible-stepfun",
      apiKey: "sk-test-stepfun",
      providerSpecificData: {
        baseUrl: "https://api.stepfun.com/v1",
        prefix: "stepplan",
      },
    });

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { id: "step-3.5-flash", name: "Step 3.5 Flash" },
          { id: "step-3.7-flash", name: "Step 3.7 Flash" },
        ],
      }),
    });

    const req = new Request("http://localhost/api/providers/conn-stepfun-import/models");
    const res = await getProviderModels(req, { params: Promise.resolve({ id: "conn-stepfun-import" }) });
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.models).toHaveLength(2);
    expect(json.models[0].id).toBe("step-3.5-flash");
    expect(json.models[1].id).toBe("step-3.7-flash");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.stepfun.com/v1/models",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test-stepfun",
        }),
      })
    );
  });

  it("TEST F: Old connection enabledModels do NOT leak unrepresented models for custom compatible providers with providerId storage", async () => {
    getProviderConnections.mockResolvedValue([
      {
        id: "conn-stepfun",
        provider: "openai-compatible-stepfun",
        apiKey: "sk-test",
        isActive: true,
        providerSpecificData: {
          baseUrl: "https://api.stepfun.com/v1",
          prefix: "stepplan",
          enabledModels: ["step-3.5-flash", "step-3.5-flash-2603"],
        },
      },
    ]);

    getCustomModels.mockResolvedValue([
      {
        id: "step-3.7-flash",
        name: "Step 3.7 Flash",
        providerAlias: "openai-compatible-stepfun",
        type: "llm",
      },
    ]);

    const models = await buildModelsList(["llm"]);
    const modelIds = models.map((m) => m.id);

    expect(modelIds).toEqual(["stepplan/step-3.7-flash"]);
  });
});
