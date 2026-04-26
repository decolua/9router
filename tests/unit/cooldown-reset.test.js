import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/lib/localDb.ts", () => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock("../../src/lib/network/connectionProxy.ts", () => ({
  resolveConnectionProxyConfig: vi.fn().mockResolvedValue({
    endpoint: "",
    connectionProxyUrl: "",
    connectionNoProxy: false,
    proxyPoolId: null,
    vercelRelayUrl: "",
  }),
}));

vi.mock("../../src/sse/utils/logger.ts", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

import { BACKOFF_CONFIG } from "../../src/lib/open-sse/config/errorConfig.ts";
import { markAccountUnavailable, getProviderCredentials, clearAccountError } from "../../src/sse/services/auth.ts";
import { getProviderConnections, updateProviderConnection, getSettings } from "../../src/lib/localDb.ts";

describe("markAccountUnavailable cooldown reset timing", () => {
  const nowMs = Date.parse("2026-04-26T10:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);
    vi.mocked(getProviderConnections).mockResolvedValue([
      {
        id: "conn-1",
        provider: "openai",
        displayName: "Primary",
        backoffLevel: 0,
      },
    ]);
    vi.mocked(getSettings).mockResolvedValue({});
    vi.mocked(updateProviderConnection).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("uses resetsAtMs when provided and in the future", async () => {
    const resetsAtMs = nowMs + 45_000;

    const result = await markAccountUnavailable(
      "conn-1",
      429,
      "rate limit",
      "openai",
      "gpt-4o-mini",
      resetsAtMs,
    );

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBe(45_000);

    const payload = vi.mocked(updateProviderConnection).mock.calls[0][1];
    const lockExpiry = Date.parse(payload["modelLock_gpt-4o-mini"]);
    expect(lockExpiry - nowMs).toBe(45_000);
  });

  it("caps reset-based cooldown at BACKOFF_CONFIG.max", async () => {
    const resetsAtMs = nowMs + 24 * 60 * 60 * 1000;

    const result = await markAccountUnavailable(
      "conn-1",
      429,
      "rate limit",
      "openai",
      "gpt-4o-mini",
      resetsAtMs,
    );

    expect(result.cooldownMs).toBe(BACKOFF_CONFIG.max);

    const payload = vi.mocked(updateProviderConnection).mock.calls[0][1];
    const lockExpiry = Date.parse(payload["modelLock_gpt-4o-mini"]);
    expect(lockExpiry - nowMs).toBe(BACKOFF_CONFIG.max);
  });

  it("keeps old backoff behavior when resetsAtMs is missing", async () => {
    const result = await markAccountUnavailable(
      "conn-1",
      429,
      "rate limit",
      "openai",
      "gpt-4o-mini",
    );

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBe(1_000);

    const payload = vi.mocked(updateProviderConnection).mock.calls[0][1];
    const lockExpiry = Date.parse(payload["modelLock_gpt-4o-mini"]);
    expect(lockExpiry - nowMs).toBe(1_000);
  });

  it("keeps old backoff behavior when resetsAtMs is in the past", async () => {
    const result = await markAccountUnavailable(
      "conn-1",
      429,
      "rate limit",
      "openai",
      "gpt-4o-mini",
      nowMs - 1,
    );

    expect(result.cooldownMs).toBe(1_000);

    const payload = vi.mocked(updateProviderConnection).mock.calls[0][1];
    const lockExpiry = Date.parse(payload["modelLock_gpt-4o-mini"]);
    expect(lockExpiry - nowMs).toBe(1_000);
  });

  it("keeps old backoff behavior when resetsAtMs equals now", async () => {
    const result = await markAccountUnavailable(
      "conn-1",
      429,
      "rate limit",
      "openai",
      "gpt-4o-mini",
      nowMs,
    );

    expect(result.cooldownMs).toBe(1_000);

    const payload = vi.mocked(updateProviderConnection).mock.calls[0][1];
    const lockExpiry = Date.parse(payload["modelLock_gpt-4o-mini"]);
    expect(lockExpiry - nowMs).toBe(1_000);
  });

  it("keeps old backoff behavior when resetsAtMs is not finite", async () => {
    const result = await markAccountUnavailable(
      "conn-1",
      429,
      "rate limit",
      "openai",
      "gpt-4o-mini",
      Number.POSITIVE_INFINITY,
    );

    expect(result.cooldownMs).toBe(1_000);

    const payload = vi.mocked(updateProviderConnection).mock.calls[0][1];
    const lockExpiry = Date.parse(payload["modelLock_gpt-4o-mini"]);
    expect(lockExpiry - nowMs).toBe(1_000);
  });
});

describe("account selection semantics regression harness", () => {
  const nowMs = Date.parse("2026-04-26T10:00:00.000Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(nowMs);
    vi.mocked(getSettings).mockResolvedValue({ comboStrategy: "fill-first" });
    vi.mocked(updateProviderConnection).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("mode 1: spec expects fresh chat to keep healthy fallback and avoid jumping back to primary too early", async () => {
    vi.mocked(getProviderConnections).mockResolvedValue([
      { id: "primary", provider: "openai", displayName: "Primary" },
      { id: "fallback", provider: "openai", displayName: "Fallback" },
    ]);

    const firstPick = await getProviderCredentials("openai", new Set(["primary"]), "gpt-4o-mini");
    expect(firstPick?.connectionName).toBe("Fallback");

    const nextChatPick = await getProviderCredentials("openai", null, "gpt-4o-mini");
    expect(nextChatPick?.connectionName).toBe("Fallback");
  });

  it("mode 2: round-robin should skip account on cooldown and select a live account using current selector state", async () => {
    vi.mocked(getSettings).mockResolvedValue({
      comboStrategy: "fill-first",
      providerStrategies: {
        openai: {
          fallbackStrategy: "round-robin",
          stickyRoundRobinLimit: 1,
        },
      },
    });

    vi.mocked(getProviderConnections).mockResolvedValue([
      {
        id: "acc-a",
        provider: "openai",
        displayName: "A",
        lastUsedAt: "2026-04-26T09:59:00.000Z",
        consecutiveUseCount: 1,
      },
      {
        id: "acc-b",
        provider: "openai",
        displayName: "B",
        lastUsedAt: "2026-04-26T09:58:00.000Z",
        consecutiveUseCount: 0,
        "modelLock_gpt-4o-mini": "2099-01-01T00:00:00.000Z",
      },
      {
        id: "acc-c",
        provider: "openai",
        displayName: "C",
        lastUsedAt: "2026-04-26T09:57:00.000Z",
        consecutiveUseCount: 0,
      },
    ]);

    const selected = await getProviderCredentials("openai", null, "gpt-4o-mini");
    expect(selected?.connectionName).toBe("A");
  });

  it("cooldown visibility: account with active model lock stays skipped on fresh chat, not reset clean", async () => {
    const futureLock = new Date(nowMs + 60_000).toISOString();

    await clearAccountError(
      "locked-acc",
      {
        _connection: {
          id: "locked-acc",
          testStatus: "unavailable",
          lastError: "rate limit",
          "modelLock_gpt-4o-mini": futureLock,
        },
      },
      "gpt-4o-mini",
    );

    expect(updateProviderConnection).toHaveBeenCalledWith(
      "locked-acc",
      expect.objectContaining({ "modelLock_gpt-4o-mini": null }),
    );

    vi.mocked(getProviderConnections).mockResolvedValue([
      {
        id: "locked-acc",
        provider: "openai",
        displayName: "Locked",
        "modelLock_gpt-4o-mini": futureLock,
      },
      {
        id: "healthy-acc",
        provider: "openai",
        displayName: "Healthy",
      },
    ]);

    const selected = await getProviderCredentials("openai", null, "gpt-4o-mini");
    expect(selected?.connectionName).toBe("Healthy");
  });
});
