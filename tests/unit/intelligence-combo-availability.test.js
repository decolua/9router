import { describe, expect, it, vi } from "vitest";

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

describe("intelligence combo model eligibility", () => {
  it("does not fall back to the static catalog when no provider connection is active", async () => {
    db.getProviderConnections.mockResolvedValue([]);

    await expect(buildModelsList(["llm"], { configuredOnly: true })).resolves.toEqual([]);
  });

  it("includes models from disabled configured connections, not just active ones", async () => {
    db.getProviderConnections.mockResolvedValue([
      { provider: "openai", isActive: false, providerSpecificData: { enabledModels: ["gpt-5"] } },
      { provider: "anthropic", isActive: true, providerSpecificData: { enabledModels: ["claude-sonnet-4-5"] } },
    ]);

    await expect(buildModelsList(["llm"], { configuredOnly: true })).resolves.toEqual([
      expect.objectContaining({ id: "openai/gpt-5", owned_by: "openai" }),
      expect.objectContaining({ id: "anthropic/claude-sonnet-4-5", owned_by: "anthropic" }),
    ]);
  });
});
