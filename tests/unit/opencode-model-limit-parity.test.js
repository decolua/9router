import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/models", () => ({ getModelAliases: vi.fn(async () => ({})), getCustomModels: vi.fn(async () => []), setModelAlias: vi.fn() }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(async () => [{ id: "opencode", provider: "opencode", isActive: true }]),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => []), getModelAliases: vi.fn(async () => ({})),
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));

afterEach(() => {
  vi.resetModules();
  vi.unstubAllGlobals();
});

const deepseek = "deepseek-v4.1-flash-free";
const liveOnly = "new-model-free";

describe("OpenCode Free model limits across the dashboard and OpenAI APIs", () => {
  it("publishes the verified gateway limits and retains limits for live-only models", async () => {
    const fetchCatalog = vi.fn(async (url) => url === "https://opencode.ai/zen/v1/models" ? Response.json({ models: [
      { id: deepseek, limit: { context: 200000, output: 32000 } },
      { id: liveOnly, limit: { context: 90000, output: 12000 } },
      { id: "paid-model", limit: { context: 1, output: 1 } },
    ] }) : new Response(null, { status: 404 }));
    const { GET } = await import("@/app/api/models/route.js");
    const { buildModelsList } = await import("@/app/api/v1/models/route.js");
    const { getCustomModels } = await import("@/models");
    getCustomModels.mockResolvedValueOnce([
      { id: deepseek, providerAlias: "oc", caps: { contextWindow: 200000, maxOutput: 32000 } },
    ]);
    vi.stubGlobal("fetch", fetchCatalog);
    const { models: dashboard } = await (await GET()).json();
    const publicModels = await buildModelsList(["llm"]);

    for (const [id, contextWindow, maxOutput] of [[deepseek, 330000, 128000], [liveOnly, 90000, 12000]]) {
      expect(dashboard.find((model) => model.routedModel === `oc/${id}`)?.caps).toMatchObject({ contextWindow, maxOutput });
      expect(publicModels.find((model) => model.id === `oc/${id}`)).toMatchObject({
        context_length: contextWindow, max_completion_tokens: maxOutput, capabilities: { contextWindow, maxOutput },
      });
    }
    expect(dashboard.filter((model) => model.routedModel === `oc/${deepseek}`)).toHaveLength(1);
    expect(dashboard.some((model) => model.routedModel === "oc/paid-model")).toBe(false);
    expect(fetchCatalog.mock.calls.filter(([url]) => url === "https://opencode.ai/zen/v1/models")).toHaveLength(1);
  });

  it("applies the same limits to an explicitly enabled model without adding other live models to the connection", async () => {
    const { GET } = await import("@/app/api/models/route.js");
    const { buildModelsList } = await import("@/app/api/v1/models/route.js");
    const { getProviderConnections } = await import("@/lib/localDb");
    getProviderConnections.mockResolvedValueOnce([{
      id: "opencode", provider: "opencode", isActive: true,
      providerSpecificData: { enabledModels: [liveOnly] },
    }]);
    vi.stubGlobal("fetch", vi.fn(async (url) => url === "https://opencode.ai/zen/v1/models"
      ? Response.json({ data: [{ id: liveOnly, limit: { context: 90000 } }, { id: deepseek }] })
      : new Response(null, { status: 404 })));

    const { models: dashboard } = await (await GET()).json();
    const publicModels = await buildModelsList(["llm"]);
    const caps = dashboard.find((model) => model.routedModel === `oc/${liveOnly}`).caps;
    expect(caps.contextWindow).toBe(90000);
    expect(publicModels.filter((model) => model.id.startsWith("oc/"))).toEqual([
      expect.objectContaining({ id: `oc/${liveOnly}`, context_length: 90000, max_completion_tokens: caps.maxOutput }),
    ]);
  });
});
