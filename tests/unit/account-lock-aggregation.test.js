import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  updateProviderConnection: mocks.updateProviderConnection,
  validateApiKey: vi.fn(),
  getProxyPools: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn().mockResolvedValue({}),
  pickProxyPoolId: vi.fn(),
}));

const MODEL = "gpt-5.6-sol";
const NOW = new Date("2026-07-20T16:00:00.000Z");
let connections;

const lockAt = (offsetMs) => new Date(NOW.getTime() + offsetMs).toISOString();
const lockedConnection = (id, offsetMs, errorCode, lastError) => ({
  id,
  priority: Number(id.match(/\d+/)?.[0] || 1),
  isActive: true,
  accessToken: `token-${id}`,
  [`modelLock_${MODEL}`]: lockAt(offsetMs),
  testStatus: "unavailable",
  errorCode,
  lastError,
});

const { getModelLockUntil } = await import("../../open-sse/services/accountFallback.js");
const { clearAccountError, getProviderCredentials } = await import("../../src/sse/services/auth.js");

describe("account lock aggregation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    connections = [];
    mocks.getProviderConnections.mockImplementation(async () => connections);
    mocks.getSettings.mockResolvedValue({ fallbackStrategy: "fill-first", providerStrategies: {} });
    mocks.updateProviderConnection.mockImplementation(async (id, update) => {
      const connection = connections.find((candidate) => candidate.id === id);
      if (connection) Object.assign(connection, update);
      return connection;
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("gets the active lock expiry for the requested model", () => {
    const requestedModelLock = lockAt(60_000);
    const connection = {
      [`modelLock_${MODEL}`]: requestedModelLock,
      "modelLock_other-model": lockAt(10_000),
    };

    expect(getModelLockUntil(connection, MODEL)).toBe(requestedModelLock);
  });

  it("uses an account-wide lock when the requested model has no lock", () => {
    const accountLock = lockAt(45_000);

    expect(getModelLockUntil({ modelLock___all: accountLock }, MODEL)).toBe(accountLock);
  });

  it("uses an active account-wide lock when the requested model lock has expired", () => {
    const accountLock = lockAt(45_000);
    const connection = {
      [`modelLock_${MODEL}`]: lockAt(-1_000),
      modelLock___all: accountLock,
    };

    expect(getModelLockUntil(connection, MODEL)).toBe(accountLock);
  });

  it("waits for both model-specific and account-wide locks to expire", () => {
    const modelLock = lockAt(45_000);
    const accountLock = lockAt(60_000);
    const connection = {
      [`modelLock_${MODEL}`]: modelLock,
      modelLock___all: accountLock,
    };

    expect(getModelLockUntil(connection, MODEL)).toBe(accountLock);
  });

  it("keeps the earliest lock expiry, status, and error paired to one account", async () => {
    const quotaLock = lockAt(120_000);
    const transientLock = lockAt(30_000);
    connections = [
      ...[1, 2, 3].map((index) => lockedConnection(`quota-${index}`, 120_000, 402, "MONTHLY_REQUEST_COUNT")),
      lockedConnection("funded-4", 30_000, 502, "Funded account bad gateway"),
      lockedConnection("funded-5", 30_000, 503, "Funded account temporarily unavailable"),
    ];

    const unavailable = await getProviderCredentials("kiro", null, MODEL);

    expect(connections.slice(0, 3).every((connection) => connection[`modelLock_${MODEL}`] === quotaLock)).toBe(true);
    expect(connections.slice(3).every((connection) => connection[`modelLock_${MODEL}`] === transientLock)).toBe(true);
    expect(unavailable).toMatchObject({
      allRateLimited: true,
      retryAfter: transientLock,
      lastError: "Funded account bad gateway",
      lastErrorCode: 502,
    });
  });

  it("preserves a genuine all-quota-exhausted result", async () => {
    connections = [1, 2, 3].map((index) => lockedConnection(
      `quota-${index}`,
      120_000,
      402,
      "MONTHLY_REQUEST_COUNT"
    ));

    const unavailable = await getProviderCredentials("kiro", null, MODEL);

    expect(unavailable).toMatchObject({
      allRateLimited: true,
      retryAfter: lockAt(120_000),
      lastError: "MONTHLY_REQUEST_COUNT",
      lastErrorCode: 402,
    });
  });

  it("selects a funded account after cooldown and clears its stale error code on success", async () => {
    connections = [lockedConnection("funded-1", 30_000, 502, "Funded account bad gateway")];
    connections[0].lastErrorAt = NOW.toISOString();
    connections[0].backoffLevel = 2;

    vi.advanceTimersByTime(31_000);
    const credentials = await getProviderCredentials("kiro", null, MODEL);
    await clearAccountError(credentials.connectionId, credentials, MODEL);

    expect(credentials.connectionId).toBe("funded-1");
    expect(connections[0]).toMatchObject({
      [`modelLock_${MODEL}`]: null,
      testStatus: "active",
      lastError: null,
      lastErrorAt: null,
      errorCode: null,
      backoffLevel: 0,
    });
  });

  it("clears errorCode even when it is the only stale error state", async () => {
    connections = [{ id: "funded-1", isActive: true, testStatus: "active", errorCode: 502 }];

    await clearAccountError("funded-1", connections[0], MODEL);

    expect(mocks.updateProviderConnection).toHaveBeenCalledWith("funded-1", expect.objectContaining({ errorCode: null }));
  });
});
