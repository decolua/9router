import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(async () => {}),
  validateApiKey: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
}));

vi.mock("@/lib/localDb", () => dbMocks);
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({
    connectionProxyEnabled: false,
    connectionProxyUrl: "",
    connectionNoProxy: "",
    proxyPoolId: null,
    vercelRelayUrl: "",
  })),
  pickProxyPoolId: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  resolveProviderId: vi.fn((provider) => provider),
  FREE_PROVIDERS: {},
}));
vi.mock("@/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

const {
  acquireProviderCredentials,
} = await import("../../src/sse/services/auth.js");
const {
  __resetAccountAdmissionForTests,
  getAdmissionSnapshot,
} = await import("../../src/sse/services/accountAdmission.js");

function connection(id, priority) {
  return {
    id,
    name: id,
    displayName: id,
    accessToken: `token-${id}`,
    authType: "oauth",
    priority,
    isActive: true,
    providerSpecificData: {},
  };
}

function settings(admission) {
  return {
    fallbackStrategy: "fill-first",
    stickyRoundRobinLimit: 1,
    providerStrategies: {
      codex: { admission },
    },
  };
}

describe("admission-aware credential acquisition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getProviderConnections.mockResolvedValue([
      connection("account-a", 1),
      connection("account-b", 2),
    ]);
    dbMocks.getSettings.mockResolvedValue(settings({
      enabled: true,
      maxInFlightPerAccount: 1,
      maxQueueSize: 10,
      queueTimeoutMs: 1000,
    }));
  });

  afterEach(() => {
    __resetAccountAdmissionForTests();
  });

  it("selects only accounts with capacity and reserves atomically", async () => {
    const first = await acquireProviderCredentials("codex", null, "gpt-5.6-sol");
    const second = await acquireProviderCredentials("codex", null, "gpt-5.6-sol");
    let thirdSettled = false;
    const thirdPromise = acquireProviderCredentials("codex", null, "gpt-5.6-sol")
      .then((value) => {
        thirdSettled = true;
        return value;
      });

    expect(first.credentials.connectionId).toBe("account-a");
    expect(second.credentials.connectionId).toBe("account-b");
    expect(thirdSettled).toBe(false);
    await vi.waitFor(() => {
      expect(getAdmissionSnapshot().providers.codex).toMatchObject({
        active: 2,
        queued: 1,
        accountCount: 2,
      });
    });

    first.lease.release();
    const third = await thirdPromise;
    expect(third.credentials.connectionId).toBe("account-a");

    second.lease.release();
    third.lease.release();
    expect(getAdmissionSnapshot().providers.codex).toMatchObject({
      enabled: true,
      active: 0,
      queued: 0,
      accountCount: 0,
      capacity: 0,
    });
  });

  it("rejects locally instead of exceeding capacity when queueing is disabled", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([connection("account-a", 1)]);
    dbMocks.getSettings.mockResolvedValue(settings({
      enabled: true,
      maxInFlightPerAccount: 1,
      maxQueueSize: 0,
      queueTimeoutMs: 1000,
    }));

    const first = await acquireProviderCredentials("codex", null, "gpt-5.6-sol");

    await expect(
      acquireProviderCredentials("codex", null, "gpt-5.6-sol"),
    ).rejects.toMatchObject({
      name: "AccountAdmissionError",
      reason: "queue_full",
    });

    first.lease.release();
    expect(getAdmissionSnapshot().providers.codex).toMatchObject({
      enabled: true,
      active: 0,
      queued: 0,
      accountCount: 0,
      capacity: 0,
    });
  });

  it("preserves the legacy path with a no-op lease when disabled", async () => {
    dbMocks.getSettings.mockResolvedValue(settings({ enabled: false }));

    const result = await acquireProviderCredentials("codex", null, "gpt-5.6-sol");

    expect(result.credentials.connectionId).toBe("account-a");
    expect(result.lease.release()).toBe(false);
    expect(getAdmissionSnapshot()).toEqual({ providers: {} });
  });

  it("returns existing unavailable state without joining the queue", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([]);

    const result = await acquireProviderCredentials("codex", null, "gpt-5.6-sol");

    expect(result.credentials).toBeNull();
    expect(result.lease.release()).toBe(false);
    expect(getAdmissionSnapshot().providers.codex).toMatchObject({
      enabled: true,
      active: 0,
      queued: 0,
      accountCount: 0,
      capacity: 0,
    });
  });
});
