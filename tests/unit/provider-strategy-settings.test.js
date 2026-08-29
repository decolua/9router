import { beforeEach, describe, expect, it, vi } from "vitest";

const dbState = vi.hoisted(() => ({ data: {} }));
const adapter = vi.hoisted(() => ({
  get: vi.fn(() => ({ data: JSON.stringify(dbState.data) })),
  run: vi.fn((_sql, params) => { dbState.data = JSON.parse(params[0]); }),
  transaction: vi.fn((fn) => fn()),
}));

vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: vi.fn(async () => adapter),
}));

const { getSettings, updateSettings } = await import("../../src/lib/db/repos/settingsRepo.js");

beforeEach(() => {
  dbState.data = {
    providerStrategies: {
      codex: { proxyPoolId: "pool-us", futureSetting: true },
      github: { proxyPoolId: "pool-eu" },
    },
  };
  vi.clearAllMocks();
});

describe("provider strategy settings patch", () => {
  it("preserves concurrent providers and unrelated fields", async () => {
    await Promise.all([
      updateSettings({
        providerStrategyPatch: {
          providerId: "codex",
          strategy: "round-robin",
          stickyLimit: "2",
          cacheAffinityEnabled: true,
        },
      }),
      updateSettings({
        providerStrategyPatch: {
          providerId: "github",
          strategy: "round-robin",
          stickyLimit: "1",
        },
      }),
    ]);

    const settings = await getSettings();
    expect(settings.providerStrategies.codex).toEqual({
      proxyPoolId: "pool-us",
      futureSetting: true,
      fallbackStrategy: "round-robin",
      stickyRoundRobinLimit: 2,
      cacheAffinityEnabled: true,
    });
    expect(settings.providerStrategies.github).toEqual({
      proxyPoolId: "pool-eu",
      fallbackStrategy: "round-robin",
      stickyRoundRobinLimit: 1,
    });
    expect(settings).not.toHaveProperty("providerStrategyPatch");
  });

  it("rejects malformed patch commands without writing", async () => {
    await expect(updateSettings({
      providerStrategyPatch: { providerId: "codex", cacheAffinityEnabled: "yes" },
    })).rejects.toThrow("providerStrategyPatch.cacheAffinityEnabled must be boolean");
    expect(adapter.run).not.toHaveBeenCalled();
  });
});
