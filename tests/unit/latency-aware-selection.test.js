/**
 * Wiring test for the `latency-aware` strategy inside getProviderCredentials().
 *
 * The healthTracker unit tests cover scoring in isolation; this one proves the
 * strategy is actually reachable from the account-selection path, that it reads
 * `settings.latencyAwareConfig`, and that the existing strategies still behave.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(() => []),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
  getSettings: mocks.getSettings,
  getProxyPools: mocks.getProxyPools,
  validateApiKey: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({
    connectionProxyEnabled: false,
    connectionProxyUrl: "",
    connectionNoProxy: "",
    proxyPoolId: null,
    vercelRelayUrl: "",
  })),
  pickProxyPoolId: vi.fn(() => null),
}));

vi.mock("@/shared/constants/providers.js", () => ({
  resolveProviderId: (p) => p,
  FREE_PROVIDERS: {},
}));

vi.mock("@/sse/utils/logger.js", () => ({
  info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn(), request: vi.fn(),
  maskKey: vi.fn(() => "masked"),
}));

import { getProviderCredentials } from "@/sse/services/auth.js";
import { recordOutcome, resetHealthStats } from "open-sse/services/healthTracker.js";

const CONNECTIONS = [
  // Priority order puts the slow account first — fill-first would always pick it.
  { id: "slow-acc", priority: 1, displayName: "Slow", authType: "apikey", apiKey: "k1", providerSpecificData: {} },
  { id: "fast-acc", priority: 2, displayName: "Fast", authType: "apikey", apiKey: "k2", providerSpecificData: {} },
];

function seedHealth() {
  for (let i = 0; i < 6; i++) {
    recordOutcome({ connectionId: "slow-acc", provider: "claude", model: "opus", ok: true, latencyMs: 2000 });
    recordOutcome({ connectionId: "fast-acc", provider: "claude", model: "opus", ok: true, latencyMs: 120 });
  }
}

describe("getProviderCredentials — latency-aware strategy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetHealthStats();
    mocks.getProviderConnections.mockResolvedValue(CONNECTIONS);
    mocks.updateProviderConnection.mockResolvedValue({});
  });

  it("routes to the faster account instead of the first by priority", async () => {
    seedHealth();
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "latency-aware" });

    const creds = await getProviderCredentials("claude", null, "opus");
    expect(creds.connectionId).toBe("fast-acc");
  });

  it("still uses priority order under the default fill-first strategy", async () => {
    seedHealth();
    mocks.getSettings.mockResolvedValue({});

    const creds = await getProviderCredentials("claude", null, "opus");
    expect(creds.connectionId).toBe("slow-acc");
  });

  it("honours a per-provider override over the global strategy", async () => {
    seedHealth();
    mocks.getSettings.mockResolvedValue({
      fallbackStrategy: "fill-first",
      providerStrategies: { claude: { fallbackStrategy: "latency-aware" } },
    });

    const creds = await getProviderCredentials("claude", null, "opus");
    expect(creds.connectionId).toBe("fast-acc");
  });

  it("probes an account with no history before ranking", async () => {
    // Only the slow account has samples; the other must be probed for data.
    for (let i = 0; i < 6; i++) {
      recordOutcome({ connectionId: "slow-acc", provider: "claude", model: "opus", ok: true, latencyMs: 2000 });
    }
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "latency-aware" });

    const creds = await getProviderCredentials("claude", null, "opus");
    expect(creds.connectionId).toBe("fast-acc");
  });

  it("skips an excluded account even when it scores best", async () => {
    seedHealth();
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "latency-aware" });

    const creds = await getProviderCredentials("claude", new Set(["fast-acc"]), "opus");
    expect(creds.connectionId).toBe("slow-acc");
  });

  it("passes latencyAwareConfig through — a raised minSamples forces probing", async () => {
    // slow-acc is both higher priority AND faster-scoring here, so picking
    // fast-acc can only come from the probe path reading the raised minSamples.
    for (let i = 0; i < 8; i++) {
      recordOutcome({ connectionId: "slow-acc", provider: "claude", model: "opus", ok: true, latencyMs: 100 });
    }
    for (let i = 0; i < 2; i++) {
      recordOutcome({ connectionId: "fast-acc", provider: "claude", model: "opus", ok: true, latencyMs: 5000 });
    }
    mocks.getSettings.mockResolvedValue({
      fallbackStrategy: "latency-aware",
      // Nothing clears 50 samples → both unproven → the account with the
      // thinnest history gets probed, regardless of priority or score.
      latencyAwareConfig: { minSamples: 50 },
    });

    const creds = await getProviderCredentials("claude", null, "opus");
    expect(creds.connectionId).toBe("fast-acc");
  });

  it("marks the selected account as used", async () => {
    seedHealth();
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "latency-aware" });

    await getProviderCredentials("claude", null, "opus");
    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "fast-acc",
      expect.objectContaining({ consecutiveUseCount: 1 })
    );
  });
});
