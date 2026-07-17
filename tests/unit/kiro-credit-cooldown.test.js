import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
  validateApiKey: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn().mockResolvedValue({}),
  pickProxyPoolId: vi.fn(),
}));

describe("markAccountUnavailable — Kiro confirmed credit-exhaustion cooldown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateProviderConnection.mockResolvedValue({});
  });

  it("caps a far-future Kiro reset at the daily-probe interval, not the full reset window", async () => {
    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const { KIRO_CREDIT_EXHAUSTION_PROBE_MS } = await import("../../open-sse/config/errorConfig.js");
    mocks.getProviderConnections.mockResolvedValue([{ id: "acc-1", backoffLevel: 0 }]);

    const now = Date.now();
    const resetsAtMs = now + 20 * 24 * 60 * 60 * 1000; // 20 days away
    const { shouldFallback, cooldownMs } = await markAccountUnavailable(
      "acc-1", 402, "Kiro monthly credit limit reached", "kiro", "claude-sonnet-4.5", resetsAtMs
    );

    expect(shouldFallback).toBe(true);
    expect(cooldownMs).toBe(KIRO_CREDIT_EXHAUSTION_PROBE_MS);
    expect(cooldownMs).toBeLessThan(resetsAtMs - now);

    const [, update] = mocks.updateProviderConnection.mock.calls[0];
    expect(update.testStatus).toBe("unavailable");
  });

  it("respects a near-term reset instead of waiting the full probe window", async () => {
    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    mocks.getProviderConnections.mockResolvedValue([{ id: "acc-1", backoffLevel: 0 }]);

    const now = Date.now();
    const resetsAtMs = now + 3 * 60 * 60 * 1000; // 3h away
    const { cooldownMs } = await markAccountUnavailable("acc-1", 402, "err", "kiro", "model-x", resetsAtMs);

    expect(cooldownMs).toBeGreaterThan(2.9 * 60 * 60 * 1000);
    expect(cooldownMs).toBeLessThanOrEqual(3 * 60 * 60 * 1000);
  });

  it("keeps the existing short cooldown for an ambiguous Kiro 402 (no resetsAtMs)", async () => {
    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    mocks.getProviderConnections.mockResolvedValue([{ id: "acc-1", backoffLevel: 0 }]);

    const { cooldownMs } = await markAccountUnavailable("acc-1", 402, "Payment required", "kiro", "model-x", null);
    expect(cooldownMs).toBe(2 * 60 * 1000); // unchanged generic 402 cooldown
  });

  it("does not change the cooldown cap for other providers' resetsAtMs (e.g. codex)", async () => {
    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const { MAX_RATE_LIMIT_COOLDOWN_MS } = await import("../../open-sse/config/errorConfig.js");
    mocks.getProviderConnections.mockResolvedValue([{ id: "acc-2", backoffLevel: 0 }]);

    const resetsAtMs = Date.now() + 6 * 60 * 60 * 1000; // 6h away, like codex resets_at
    const { cooldownMs } = await markAccountUnavailable("acc-2", 429, "usage_limit_reached", "codex", "gpt-5", resetsAtMs);
    expect(cooldownMs).toBe(MAX_RATE_LIMIT_COOLDOWN_MS);
  });

  it("clears the lock and allows selection again once the capped cooldown expires", async () => {
    const { buildModelLockUpdate, isModelLockActive } = await import("../../open-sse/services/accountFallback.js");
    const cooldownMs = 50;
    const lock = buildModelLockUpdate("model-x", cooldownMs);
    const conn = { id: "acc-1", ...lock };

    expect(isModelLockActive(conn, "model-x")).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, cooldownMs + 20));
    expect(isModelLockActive(conn, "model-x")).toBe(false);
  });

  it("multi-account fallback: a locked Kiro account is skipped while a sibling account stays available", async () => {
    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    const { isModelLockActive } = await import("../../open-sse/services/accountFallback.js");

    const connA = { id: "acc-A", backoffLevel: 0 };
    const connB = { id: "acc-B", backoffLevel: 0 };
    mocks.getProviderConnections.mockResolvedValue([connA, connB]);
    let capturedUpdate = null;
    mocks.updateProviderConnection.mockImplementation((id, update) => {
      capturedUpdate = update;
      return Promise.resolve({});
    });

    const resetsAtMs = Date.now() + 20 * 24 * 60 * 60 * 1000;
    await markAccountUnavailable("acc-A", 402, "Kiro monthly credit limit reached", "kiro", "model-x", resetsAtMs);

    // Mirrors what getProviderCredentials' availableConnections filter does (src/sse/services/auth.js)
    const updatedConnA = { ...connA, ...capturedUpdate };
    const available = [updatedConnA, connB].filter((c) => !isModelLockActive(c, "model-x"));

    expect(isModelLockActive(updatedConnA, "model-x")).toBe(true);
    expect(isModelLockActive(connB, "model-x")).toBe(false);
    expect(available.map((c) => c.id)).toEqual(["acc-B"]);
  });
});
