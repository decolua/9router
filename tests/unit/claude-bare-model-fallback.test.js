import { beforeEach, describe, expect, it, vi } from "vitest";

const connections = vi.hoisted(() => ({ anthropic: [], claude: [] }));

vi.mock("@/lib/localDb", () => ({
  getModelAliases: async () => ({}),
  getComboByName: async () => null,
  getProviderNodes: async () => [],
  getProviderConnections: async ({ provider }) => connections[provider] ?? [],
}));

import { getModelInfo } from "../../src/sse/services/model.js";

describe("bare claude-* model routing", () => {
  beforeEach(() => {
    connections.anthropic = [];
    connections.claude = [];
  });

  it("keeps provider anthropic when nothing is connected", async () => {
    expect(await getModelInfo("claude-sonnet-5-5")).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5" });
  });

  it("uses the Claude OAuth connection when no anthropic connection is active", async () => {
    connections.claude = [{ id: "c1" }];
    expect(await getModelInfo("claude-sonnet-5-5")).toEqual({ provider: "claude", model: "claude-sonnet-5-5" });
  });

  it("keeps anthropic when an anthropic connection is active", async () => {
    connections.anthropic = [{ id: "a1" }];
    connections.claude = [{ id: "c1" }];
    expect(await getModelInfo("claude-sonnet-5-5")).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5" });
  });

  it("does not touch an explicit provider prefix", async () => {
    connections.claude = [{ id: "c1" }];
    expect(await getModelInfo("anthropic/claude-sonnet-5-5")).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5" });
  });

  it("does not touch other model families", async () => {
    connections.claude = [{ id: "c1" }];
    expect((await getModelInfo("gpt-4o")).provider).toBe("openai");
  });
});
