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

describe("Antigravity capacity fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnections.mockResolvedValue([
      { id: "ag-1", provider: "antigravity", email: "ag@example.com", backoffLevel: 4 },
    ]);
  });

  it("falls back without writing model cooldown for MODEL_CAPACITY_EXHAUSTED", async () => {
    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const result = await markAccountUnavailable(
      "ag-1",
      503,
      '{"reason":"MODEL_CAPACITY_EXHAUSTED","message":"No capacity available for model claude-opus-4-6-thinking on the server"}',
      "antigravity",
      "claude-opus-4-6-thinking",
    );

    expect(result).toEqual({ shouldFallback: true, cooldownMs: 0 });
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("keeps normal cooldown behavior for non-Antigravity capacity text", async () => {
    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const result = await markAccountUnavailable(
      "ag-1",
      503,
      "No capacity available for model x",
      "kiro",
      "some-model",
    );

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "ag-1",
      expect.objectContaining({
        testStatus: "unavailable",
        errorCode: 503,
      }),
    );
  });
});
