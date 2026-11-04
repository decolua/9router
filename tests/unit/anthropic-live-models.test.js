import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(),
  getModelAliases: vi.fn(),
  getDisabledModels: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getCombos: mocks.getCombos,
  getCustomModels: mocks.getCustomModels,
  getModelAliases: mocks.getModelAliases,
}));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: mocks.getDisabledModels }));

const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

const conn = { id: "c1", provider: "anthropic", isActive: true, apiKey: "sk-ant-api03-test", providerSpecificData: {} };
const anthropicIds = (list) => list.map((m) => m.id).filter((id) => id.startsWith("anthropic/"));

describe("anthropic API-key /v1/models uses the live catalog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([conn]);
    mocks.getCombos.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
  });

  it("lists the models the key can actually reach", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "claude-opus-5-5", display_name: "Claude Opus 5.5" }, { id: "claude-haiku-5-5", display_name: "Claude Haiku 5.5" }],
    }), { status: 200 }));

    const ids = anthropicIds(await buildModelsList(["llm"]));

    expect(ids).toEqual(["anthropic/claude-opus-5-5", "anthropic/claude-haiku-5-5"]);
    const [url, init] = fetchSpy.mock.calls.find(([u]) => String(u).includes("api.anthropic.com/v1/models"));
    expect(url).toContain("limit=1000");
    expect(init.headers["x-api-key"]).toBe("sk-ant-api03-test");
    fetchSpy.mockRestore();
  });

  it("falls back to the static registry list when the live call fails", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 401 }));

    const ids = anthropicIds(await buildModelsList(["llm"]));

    expect(ids.length).toBeGreaterThan(0);
    fetchSpy.mockRestore();
  });
});
