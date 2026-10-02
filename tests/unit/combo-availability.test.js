import { beforeEach, describe, expect, it, vi } from "vitest";

const getComboByName = vi.fn();
const getProviderConnections = vi.fn();
const getProviderNodes = vi.fn();
const getDisabledModels = vi.fn();

vi.mock("@/lib/localDb", () => ({
  getModelAliases: vi.fn(() => ({})),
  getComboByName,
  getProviderConnections,
  getProviderNodes,
}));
vi.mock("@/lib/db/index.js", () => ({ getDisabledModels }));

const { filterAvailableProviders, getComboModels } = await import("../../src/sse/services/model.js");

describe("combo availability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProviderNodes.mockResolvedValue([]);
    getDisabledModels.mockResolvedValue({});
  });

  it("drops inactive providers and disabled models while preserving order", async () => {
    getComboByName.mockResolvedValue({
      name: "coding",
      models: ["openai/gpt-5", "claude/claude-sonnet-4", "openai/gpt-4o"],
    });
    getProviderConnections.mockResolvedValue([{ provider: "openai", isActive: true }]);
    getDisabledModels.mockResolvedValue({ openai: ["gpt-4o"] });

    await expect(getComboModels("coding")).resolves.toEqual(["openai/gpt-5"]);
  });

  it("returns an empty array for an existing combo with no routable members", async () => {
    getComboByName.mockResolvedValue({ name: "offline", models: ["claude/claude-sonnet-4"] });
    getProviderConnections.mockResolvedValue([]);

    await expect(getComboModels("offline")).resolves.toEqual([]);
  });

  it("keeps no-auth and credential-fallback web providers", async () => {
    getProviderConnections.mockResolvedValue([{ provider: "ollama", isActive: true }]);

    await expect(filterAvailableProviders(["searxng", "ollama-search", "tavily"]))
      .resolves.toEqual(["searxng", "ollama-search"]);
  });
});
