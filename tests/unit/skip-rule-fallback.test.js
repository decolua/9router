import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
  validateApiKey: mocks.validateApiKey,
  getSettings: mocks.getSettings,
}));

describe("skip-rule fallback (generalized, non-Antigravity)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([
      { id: "kr-1", provider: "kr-ac", email: "k@example.com", backoffLevel: 0 },
    ]);
  });

  it("connect_timeout with action:skip → fallback without DB cooldown", async () => {
    mocks.getSettings.mockResolvedValue({
      providerSkipRules: [{ provider: "kr-ac", match: { kind: "connect_timeout" }, action: "skip" }],
    });
    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const result = await markAccountUnavailable(
      "kr-1", 502, "[502]: fetch connect timeout", "kr-ac", "claude-sonnet-5", null, "connect_timeout",
    );
    // resweep:false — the connect_timeout skip rule has no sweep:true opt-in.
    expect(result).toEqual({ shouldFallback: true, cooldownMs: 0, failFast: true, resweep: false });
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled(); // no lock written
  });

  it("skip rule with sweep:true → resweep:true (separate from failFast)", async () => {
    mocks.getSettings.mockResolvedValue({
      providerSkipRules: [{ provider: "kr-ac", match: { status: 503, contains: "capacity" }, action: "skip", sweep: true }],
    });
    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const result = await markAccountUnavailable(
      "kr-1", 503, "MODEL_CAPACITY_EXHAUSTED", "kr-ac", "claude-sonnet-5", null, "http_503",
    );
    expect(result).toEqual({ shouldFallback: true, cooldownMs: 0, failFast: true, resweep: true });
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("no matching rule → normal cooldown + DB lock", async () => {
    mocks.getSettings.mockResolvedValue({ providerSkipRules: [] });
    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const result = await markAccountUnavailable(
      "kr-1", 502, "[502]: fetch connect timeout", "kr-ac", "claude-sonnet-5", null, "connect_timeout",
    );
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "kr-1",
      expect.objectContaining({ testStatus: "unavailable", errorCode: 502 }),
    );
  });
});
