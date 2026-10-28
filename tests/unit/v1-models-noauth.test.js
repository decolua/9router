import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

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

const ZEN_CATALOG = [
  { id: "mimo-v2.6-flash-free" },
  { id: "big-pickle" },
  { id: "deepseek-v4-flash-free" }, // DEAD — filtered upstream by the suggested-models filter
  { id: "paid-only-model" }, // no -free suffix and not a known free model
];

describe("/v1/models noAuth providers", () => {
  beforeEach(() => {
    db.getProviderConnections.mockResolvedValue([
      {
        id: 1,
        provider: "llm7",
        isActive: true,
        providerSpecificData: { enabledModels: ["codestral-latest"] },
      },
    ]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ data: ZEN_CATALOG }) }))
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("publishes noAuth provider models even with no connection row", async () => {
    const models = await buildModelsList(["llm"]);
    const ocIds = models.filter((m) => m.owned_by === "oc").map((m) => m.id);

    expect(ocIds).toContain("oc/mimo-v2.6-flash-free");
    expect(ocIds).toContain("oc/big-pickle");
    // the connection-backed provider still lists its models
    expect(models.some((m) => m.owned_by === "llm7")).toBe(true);
  });

  it("applies the provider's live-model filter and never duplicates ids", async () => {
    const models = await buildModelsList(["llm"]);
    const ids = models.map((m) => m.id);

    expect(ids).not.toContain("oc/deepseek-v4-flash-free");
    expect(ids).not.toContain("oc/paid-only-model");
    // hidden providers (mimo-free/mmf — upstream ended the free channel) stay unroutable-by-list
    expect(ids).not.toContain("mmf/mimo-auto");
    expect(ids).not.toContain("mimo-free/mimo-auto");
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("skips the live fetch for non-LLM kind filters", async () => {
    db.getProviderConnections.mockResolvedValue([]);
    const models = await buildModelsList(["embedding"]);
    expect(models.some((m) => m.owned_by === "oc")).toBe(false);
  });
});
