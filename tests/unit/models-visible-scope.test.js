import { beforeEach, describe, expect, it, vi } from "vitest";

// /v1/models advertises what the dashboard shows as a provider's models —
// the built-in list minus disabled ids, plus custom models and aliases — and
// the combos. The per-account synced catalogue and a compatible node's live
// /models answer can hold hundreds of ids nobody curated; those stay behind
// `?scope=all` (buildModelsList scope "all") for tooling that needs every
// routable id, e.g. the combo pruner.

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getComboByName: vi.fn(),
  getProviderNodes: vi.fn(),
  getProviderConnectionById: vi.fn(),
  getDisabledModels: vi.fn(),
  resolveClineModels: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
  getComboByName: mocks.getComboByName,
  getProviderNodes: mocks.getProviderNodes,
  getProviderConnectionById: mocks.getProviderConnectionById,
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: mocks.getDisabledModels }));
vi.mock("open-sse/providers/catalogOverride.js", () => ({ getCatalogCost: vi.fn(() => null) }));

vi.mock("open-sse/services/kiroModels.js", () => ({ resolveKiroModels: vi.fn(async () => null) }));
vi.mock("open-sse/services/kimchiModels.js", () => ({ resolveKimchiModels: vi.fn(async () => null) }));
vi.mock("open-sse/services/qoderModels.js", () => ({ resolveQoderModels: vi.fn(async () => null), routableQoderModels: vi.fn(() => []) }));
vi.mock("open-sse/services/copilotModels.js", () => ({ resolveCopilotModels: vi.fn(async () => null) }));
vi.mock("open-sse/services/clinepassModels.js", () => ({
  resolveClinepassModels: vi.fn(async () => null),
  resolveClineModels: mocks.resolveClineModels,
}));
vi.mock("open-sse/services/grokCliModels.js", () => ({ resolveGrokCliModels: vi.fn(async () => null) }));
vi.mock("open-sse/services/cursorModels.js", () => ({ resolveCursorModels: vi.fn(async () => null) }));
vi.mock("open-sse/shared/zedAuth.js", () => ({ resolveZedModels: vi.fn(async () => null) }));
vi.mock("@/sse/services/tokenRefresh", () => ({ updateProviderCredentials: vi.fn(async () => {}) }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn(async () => ({})) }));

import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { buildModelsList, GET } from "../../src/app/api/v1/models/route.js";

const CLINE_ALIAS = PROVIDER_ID_TO_ALIAS.cline;
const CLINE_STATIC = (PROVIDER_MODELS[CLINE_ALIAS] || []).map((m) => m.id);
const COMPAT = "openai-compatible-chat-test";

function clineConn() {
  return {
    id: "cline-1",
    provider: "cline",
    isActive: true,
    providerSpecificData: {},
    modelCatalog: {
      models: [
        { id: "someone/uncurated-model", tier: "free", availability: "available" },
        ...(CLINE_STATIC[0] ? [{ id: CLINE_STATIC[0], tier: "free", availability: "available" }] : []),
      ],
    },
  };
}

function compatConn() {
  return {
    id: "compat-1",
    provider: COMPAT,
    isActive: true,
    apiKey: "sk-x",
    providerSpecificData: { baseUrl: "https://example.invalid/v1" },
    modelCatalog: { models: [{ id: "compat-uncurated", availability: "available" }] },
  };
}

const ids = (list) => list.map((m) => m.id);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProviderConnections.mockResolvedValue([clineConn(), compatConn()]);
  mocks.getCombos.mockResolvedValue([{ name: "my-combo", models: [`${CLINE_ALIAS}/${CLINE_STATIC[0]}`] }]);
  mocks.getCustomModels.mockResolvedValue([{ id: "compat-picked", providerAlias: COMPAT, type: "llm" }]);
  mocks.getModelAliases.mockResolvedValue({});
  mocks.getDisabledModels.mockResolvedValue({ [CLINE_ALIAS]: [CLINE_STATIC[1]] });
  mocks.resolveClineModels.mockResolvedValue({ models: [{ id: "live/only-model" }] });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ id: "compat-live-only" }] })));
});

describe("/v1/models visible scope (default)", () => {
  it("has a static cline list to test against", () => {
    expect(CLINE_STATIC.length).toBeGreaterThan(1);
  });

  it("lists combos plus each provider's visible models only", async () => {
    const listed = ids(await buildModelsList(["llm"], { scope: "visible" }));
    expect(listed).toContain("my-combo");
    expect(listed).toContain(`${CLINE_ALIAS}/${CLINE_STATIC[0]}`);
    expect(listed).toContain(`${COMPAT}/compat-picked`);
    // disabled on the provider page stays out
    expect(listed).not.toContain(`${CLINE_ALIAS}/${CLINE_STATIC[1]}`);
    // synced catalogue, live resolver and compatible /models are not visible
    expect(listed).not.toContain(`${CLINE_ALIAS}/someone/uncurated-model`);
    expect(listed).not.toContain(`${CLINE_ALIAS}/live/only-model`);
    expect(listed).not.toContain(`${COMPAT}/compat-uncurated`);
    expect(listed).not.toContain(`${COMPAT}/compat-live-only`);
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.resolveClineModels).not.toHaveBeenCalled();
  });

  it("still enriches visible models with the synced tier", async () => {
    const list = await buildModelsList(["llm"], { scope: "visible" });
    const model = list.find((m) => m.id === `${CLINE_ALIAS}/${CLINE_STATIC[0]}`);
    expect(model?.tier).toBe("free");
  });

  it("GET /v1/models defaults to the visible scope", async () => {
    const res = await GET(new Request("http://localhost/v1/models"));
    const listed = ids((await res.json()).data);
    expect(listed).toContain("my-combo");
    expect(listed).not.toContain(`${COMPAT}/compat-uncurated`);
  });
});

describe("/v1/models?scope=all keeps the full routable catalogue", () => {
  it("GET with scope=all includes the synced/live ids", async () => {
    const res = await GET(new Request("http://localhost/v1/models?scope=all"));
    const listed = ids((await res.json()).data);
    expect(listed).toContain("my-combo");
    expect(listed).toContain(`${CLINE_ALIAS}/live/only-model`);
    expect(listed).toContain(`${COMPAT}/compat-uncurated`);
    expect(listed).toContain(`${COMPAT}/compat-picked`);
  });
});
