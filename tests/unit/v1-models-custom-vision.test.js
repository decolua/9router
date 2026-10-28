import { describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(async () => [{ id: "fw-1", provider: "fireworks", isActive: true }]),
  getCombos: vi.fn(async () => []),
  getCustomModels: vi.fn(async () => [{ providerAlias: "fireworks", id: "my-image-model", type: "llm", caps: { vision: true } }]),
  getModelAliases: vi.fn(async () => ({})),
}));

vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: vi.fn(async () => ({})) }));

const { buildModelsList } = await import("../../src/app/api/v1/models/route.js");

describe("/v1/models custom capabilities", () => {
  it("advertises Fireworks custom vision capability from the dashboard toggle", async () => {
    const models = await buildModelsList(["llm"], { skipDynamicFetch: true });
    expect(models.find((model) => model.id === "fireworks/my-image-model"))
      .toMatchObject({ capabilities: { vision: true } });
  });
});
