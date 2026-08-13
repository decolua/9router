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

vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: mocks.getDisabledModels,
}));

// The models route pulls in heavy open-sse module chains; import it lazily so
// the mocks above are registered first.
const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

const LLM_KIND = "llm";

describe("buildModelsList — empty-connection behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCombos.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getDisabledModels.mockResolvedValue({});
  });

  it("does NOT dump the full built-in catalog when the DB is healthy but has zero provider connections", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);
    // User explicitly added a couple of OpenCode free models.
    mocks.getCustomModels.mockResolvedValue([
      { providerAlias: "oc", id: "mimo-v2.5-free", type: "llm", name: "mimo-v2.5-free" },
      { providerAlias: "oc", id: "deepseek-v4-flash-free", type: "llm", name: "deepseek-v4-flash-free" },
    ]);

    const models = await buildModelsList([LLM_KIND]);
    const ids = models.map((m) => m.id);

    // User-configured custom models ARE exposed...
    expect(ids).toContain("oc/mimo-v2.5-free");
    expect(ids).toContain("oc/deepseek-v4-flash-free");

    // ...but the full static catalog is NOT (a known built-in model must be absent),
    // and the list stays small instead of the ~680 built-in entries.
    expect(ids).not.toContain("alicode-intl/qwen3.5-plus");
    expect(models.length).toBeLessThan(50);
  });

  it("still returns the full static catalog as a fallback when the DB itself is unavailable", async () => {
    mocks.getProviderConnections.mockRejectedValue(new Error("db gone"));

    const models = await buildModelsList([LLM_KIND]);
    const ids = models.map((m) => m.id);

    // Known built-in model present when DB is truly unavailable (fallback).
    expect(ids).toContain("alicode-intl/qwen3.5-plus");
    expect(models.length).toBeGreaterThan(100);
  });

  it("keeps per-connection model listing when connections exist (unchanged behavior)", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      {
        id: "conn-1",
        provider: "openai-compatible",
        authType: "apikey",
        isActive: true,
        providerSpecificData: { baseUrl: "https://example.com/v1", prefix: "my" },
      },
    ]);
    // Compatible providers may attempt a live /models fetch; make it return empty
    // so the test stays hermetic and focused on the empty-connection fix.
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 })
    );

    const models = await buildModelsList([LLM_KIND]);
    // Static catalog is not dumped wholesale when a connection exists.
    const ids = models.map((m) => m.id);
    expect(ids).not.toContain("alicode-intl/qwen3.5-plus");
  });
});
