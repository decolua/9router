import { beforeEach, describe, expect, it, vi } from "vitest";

const localDbMocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getProviderNodes: vi.fn(),
  getComboByName: vi.fn(),
  getModelAliases: vi.fn(),
}));

vi.mock("../../src/lib/localDb.js", () => localDbMocks);

import {
  createRequestContext,
  getRequestComboByName,
  getRequestModelAliases,
  getRequestProviderNodes,
  getRequestSettings,
} from "../../src/sse/services/requestContext.js";

describe("requestContext caching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reuses settings within the same request context", async () => {
    const context = createRequestContext();
    localDbMocks.getSettings.mockResolvedValue({ requireApiKey: true });

    const first = await getRequestSettings(context);
    const second = await getRequestSettings(context);

    expect(first).toEqual({ requireApiKey: true });
    expect(second).toBe(first);
    expect(localDbMocks.getSettings).toHaveBeenCalledTimes(1);
  });

  it("reuses provider nodes and filters them in memory", async () => {
    const context = createRequestContext();
    localDbMocks.getProviderNodes.mockResolvedValue([
      { id: "oa-1", type: "openai-compatible", prefix: "oa" },
      { id: "an-1", type: "anthropic-compatible", prefix: "an" },
    ]);

    const openaiNodes = await getRequestProviderNodes("openai-compatible", context);
    const anthropicNodes = await getRequestProviderNodes("anthropic-compatible", context);
    const allNodes = await getRequestProviderNodes(null, context);

    expect(openaiNodes).toEqual([{ id: "oa-1", type: "openai-compatible", prefix: "oa" }]);
    expect(anthropicNodes).toEqual([{ id: "an-1", type: "anthropic-compatible", prefix: "an" }]);
    expect(allNodes).toHaveLength(2);
    expect(localDbMocks.getProviderNodes).toHaveBeenCalledTimes(1);
  });

  it("memoizes combo lookups by name within a request", async () => {
    const context = createRequestContext();
    const combo = { name: "fast", models: ["a", "b"] };
    localDbMocks.getComboByName.mockResolvedValue(combo);

    const first = await getRequestComboByName("fast", context);
    const second = await getRequestComboByName("fast", context);

    expect(first).toBe(combo);
    expect(second).toBe(combo);
    expect(localDbMocks.getComboByName).toHaveBeenCalledTimes(1);
  });

  it("caches different combo names independently", async () => {
    const context = createRequestContext();
    const fastCombo = { name: "fast", models: ["a"] };
    const slowCombo = { name: "slow", models: ["b"] };
    localDbMocks.getComboByName.mockImplementation((name) =>
      Promise.resolve(name === "fast" ? fastCombo : slowCombo)
    );

    const [fast, slow] = await Promise.all([
      getRequestComboByName("fast", context),
      getRequestComboByName("slow", context),
    ]);

    expect(fast).toBe(fastCombo);
    expect(slow).toBe(slowCombo);
    expect(localDbMocks.getComboByName).toHaveBeenCalledTimes(2);

    // Second lookup reuses cache
    const fast2 = await getRequestComboByName("fast", context);
    expect(fast2).toBe(fastCombo);
    expect(localDbMocks.getComboByName).toHaveBeenCalledTimes(2);
  });

  it("reuses model aliases within the same request context", async () => {
    const context = createRequestContext();
    const aliases = { sonnet: "claude/sonnet-4" };
    localDbMocks.getModelAliases.mockResolvedValue(aliases);

    const first = await getRequestModelAliases(context);
    const second = await getRequestModelAliases(context);

    expect(first).toBe(aliases);
    expect(second).toBe(aliases);
    expect(localDbMocks.getModelAliases).toHaveBeenCalledTimes(1);
  });
});
