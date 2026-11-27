import { describe, expect, it, vi } from "vitest";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";

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

async function listFor(providerId, modelId) {
  db.getProviderConnections.mockResolvedValue([{
    id: 1,
    provider: providerId,
    isActive: true,
    providerSpecificData: { enabledModels: [modelId] },
  }]);
  const models = await buildModelsList(["llm"]);
  return models.find((m) => m.id.endsWith(`/${modelId}`));
}

describe("/v1/models thinking_levels", () => {
  it("publishes the same levels the dashboard picker uses", async () => {
    const entry = await listFor("claude", "claude-haiku-5-5");
    expect(entry).toBeDefined();
    expect(entry.thinking_levels).toEqual(getThinkingLevels("claude", "claude-haiku-5-5"));
    expect(entry.thinking_levels.length).toBeGreaterThan(0);
  });

  it("omits the field for models without reasoning", async () => {
    const entry = await listFor("claude", "claude-haiku-4-5-20251001");
    if (entry && getThinkingLevels("claude", "claude-haiku-4-5-20251001") === null) {
      expect(entry).not.toHaveProperty("thinking_levels");
    }
  });
});
