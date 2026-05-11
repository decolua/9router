import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getModelAliases: vi.fn(),
  getModelDisplayNames: vi.fn(async () => ({
    "cc/claude-sonnet-4-5": "my-fast-claude",
    "openai/gpt-4.1": "work-gpt",
  })),
  getComboByName: vi.fn(),
  getProviderNodes: vi.fn(),
}));

describe("model display names", () => {
  it("resolves display model IDs back to origin model IDs", async () => {
    const { resolveDisplayModelId } =
      await import("../../src/sse/services/model.js");

    await expect(resolveDisplayModelId("my-fast-claude")).resolves.toEqual({
      model: "cc/claude-sonnet-4-5",
      changed: true,
      displayModel: "my-fast-claude",
    });
  });

  it("leaves origin model IDs unchanged", async () => {
    const { resolveDisplayModelId } =
      await import("../../src/sse/services/model.js");

    await expect(
      resolveDisplayModelId("cc/claude-sonnet-4-5"),
    ).resolves.toEqual({
      model: "cc/claude-sonnet-4-5",
      changed: false,
    });
  });
});
