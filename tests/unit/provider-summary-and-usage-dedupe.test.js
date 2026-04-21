import { describe, it, expect, vi, beforeEach } from "vitest";

import { createSingleFlight, runWithConcurrency } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/refreshQueue.js";
import { runUsageRefreshJob } from "../../src/lib/usageRefreshQueue.js";

const providerConnections = [];
const providerNodes = [];
const providerConnectionById = new Map();

const getProviderConnections = vi.fn(async () => providerConnections);
const getProviderNodes = vi.fn(async () => providerNodes);
const getProxyPoolById = vi.fn(async () => null);
const getProviderConnectionById = vi.fn(async (id) => providerConnectionById.get(id) || null);
const updateProviderConnection = vi.fn(async () => ({}));
const getUsageForProvider = vi.fn(async () => ({ message: "ok", plan: "pro" }));
const writeConnectionHotState = vi.fn(async ({ patch }) => patch);
const projectLegacyConnectionState = vi.fn((snapshot = {}) => ({
  testStatus: snapshot.routingStatus === "blocked_quota" ? "unavailable" : "active",
  lastTested: snapshot.lastCheckedAt || null,
  lastError: snapshot.reasonDetail ?? snapshot.lastError ?? null,
  lastErrorType: snapshot.reasonCode && snapshot.reasonCode !== "unknown" ? snapshot.reasonCode : snapshot.lastErrorType ?? null,
  lastErrorAt: snapshot.lastErrorAt ?? null,
  rateLimitedUntil: snapshot.nextRetryAt ?? snapshot.rateLimitedUntil ?? null,
  errorCode: snapshot.errorCode ?? (snapshot.reasonCode && snapshot.reasonCode !== "unknown" ? snapshot.reasonCode : null),
}));
const getExecutor = vi.fn(() => ({
  needsRefresh: vi.fn(() => false),
  refreshCredentials: vi.fn(async () => null),
}));
const mockRedisClient = {
  isReady: true,
  set: vi.fn(async () => "OK"),
  get: vi.fn(async () => null),
  del: vi.fn(async () => 1),
  rPush: vi.fn(async () => 1),
  expire: vi.fn(async () => 1),
  zRemRangeByScore: vi.fn(async () => 0),
  zCard: vi.fn(async () => 0),
  lRange: vi.fn(async () => []),
  zAdd: vi.fn(async () => 1),
  lRem: vi.fn(async () => 1),
  zRem: vi.fn(async () => 1),
  hGetAll: vi.fn(async () => ({})),
  connect: vi.fn(async () => mockRedisClient),
  on: vi.fn(),
  multi: vi.fn(() => ({
    zAdd: vi.fn().mockReturnThis(),
    lRem: vi.fn().mockReturnThis(),
    expire: vi.fn().mockReturnThis(),
    exec: vi.fn(async () => []),
  })),
};

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    }),
  },
}));

vi.mock("@/models", () => ({
  getProviderConnections,
  createProviderConnection: vi.fn(),
  getProviderNodeById: vi.fn(async () => null),
  getProviderNodes,
  getProxyPoolById,
}));

vi.mock("@/shared/constants/config", () => ({
  APIKEY_PROVIDERS: {},
  FREE_TIER_PROVIDERS: {},
}));

vi.mock("@/shared/constants/providers", () => ({
  FREE_TIER_PROVIDERS: {},
  isOpenAICompatibleProvider: () => false,
  isAnthropicCompatibleProvider: () => false,
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById,
  updateProviderConnection,
  getConnectionStatusSummary: (connections = []) => ({
    connected: connections.filter((c) => c.testStatus === "active" || c.testStatus === "success").length,
    error: connections.filter((c) => c.testStatus === "error" || c.testStatus === "expired" || c.testStatus === "unavailable").length,
    unknown: connections.filter((c) => !["active", "success", "error", "expired", "unavailable"].includes(c.testStatus)).length,
    total: connections.length,
    allDisabled: connections.length > 0 && connections.every((c) => c.isActive === false),
  }),
}));

vi.mock("@/lib/providerHotState", () => ({
  writeConnectionHotState,
  projectLegacyConnectionState,
}));

vi.mock("open-sse/services/usage.js", () => ({
  getUsageForProvider,
}));

vi.mock("open-sse/executors/index.js", () => ({
  getExecutor,
}));

vi.mock("open-sse/index.js", () => ({}));

vi.mock("redis", () => ({
  createClient: vi.fn(() => mockRedisClient),
}));

describe("provider summary API and usage dedupe", () => {
  beforeEach(() => {
    providerConnections.length = 0;
    providerNodes.length = 0;
    providerConnectionById.clear();
    getProviderConnections.mockClear();
    getProviderNodes.mockClear();
    getProxyPoolById.mockClear();
    getProviderConnectionById.mockClear();
    updateProviderConnection.mockClear();
    getUsageForProvider.mockClear();
    writeConnectionHotState.mockClear();
    projectLegacyConnectionState.mockClear();
    getExecutor.mockClear();
    mockRedisClient.set.mockClear();
    mockRedisClient.get.mockClear();
    mockRedisClient.del.mockClear();
    mockRedisClient.rPush.mockClear();
    mockRedisClient.expire.mockClear();
    mockRedisClient.zRemRangeByScore.mockClear();
    mockRedisClient.zCard.mockClear();
    mockRedisClient.lRange.mockClear();
    mockRedisClient.zAdd.mockClear();
    mockRedisClient.lRem.mockClear();
    mockRedisClient.zRem.mockClear();
    mockRedisClient.multi.mockClear();
    getProviderConnections.mockResolvedValue(providerConnections);
    getProviderNodes.mockResolvedValue(providerNodes);
    process.env.USAGE_QUEUE_CONCURRENCY = "3";
    delete process.env.USAGE_QUEUE_WAIT_TIMEOUT_MS;
    delete process.env.USAGE_QUEUE_MAX_QUEUED;
    delete process.env.USAGE_QUEUE_REDIS_RETRY_COOLDOWN_MS;
    delete process.env.REDIS_URL;
    delete process.env.REDIS_HOST;
  });

  it("returns provider summaries grouped by provider and auth type", async () => {
    providerConnections.push(
      { id: "c1", provider: "codex", authType: "oauth", testStatus: "active", isActive: true },
      { id: "c2", provider: "codex", authType: "oauth", testStatus: "error", isActive: true },
      { id: "c3", provider: "openai", authType: "apikey", testStatus: "unknown", isActive: true },
    );

    const { GET } = await import("../../src/app/api/providers/route.js");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.providerSummaries).toMatchObject({
      codex: {
        oauth: {
          connected: 1,
          error: 1,
          unknown: 0,
          total: 2,
        },
      },
      openai: {
        apikey: {
          connected: 0,
          error: 0,
          unknown: 1,
          total: 1,
        },
      },
    });
  });

  it("dedupes concurrent usage requests for the same connection", async () => {
    providerConnectionById.set("conn-1", {
      id: "conn-1",
      provider: "codex",
      authType: "oauth",
      accessToken: "token",
      refreshToken: "refresh",
      providerSpecificData: {},
    });

    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");

    const first = GET(new Request("http://localhost/api/usage/conn-1"), {
      params: Promise.resolve({ connectionId: "conn-1" }),
    });
    const second = GET(new Request("http://localhost/api/usage/conn-1"), {
      params: Promise.resolve({ connectionId: "conn-1" }),
    });

    const [firstResponse, secondResponse] = await Promise.all([first, second]);

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(getUsageForProvider).toHaveBeenCalledTimes(1);
    expect(writeConnectionHotState).toHaveBeenCalledTimes(1);
  });

  it("runs queued refreshes with a bounded concurrency limit", async () => {
    const items = Array.from({ length: 6 }, (_, index) => ({ id: `c${index + 1}` }));
    let inFlight = 0;
    let maxInFlight = 0;

    await runWithConcurrency(items, 2, async (item) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return item.id;
    });

    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it("shares one in-flight refresh across overlapping callers", async () => {
    const runSingleFlight = createSingleFlight();
    let calls = 0;

    const first = runSingleFlight(async () => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 5));
      return "first";
    });

    const second = runSingleFlight(async () => {
      calls += 1;
      return "second";
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toBe("first");
    expect(secondResult).toBe("first");
    expect(calls).toBe(1);
  });

  it("caps backend usage refresh concurrency across different connections", async () => {
    let activeCalls = 0;
    let maxActiveCalls = 0;

    getUsageForProvider.mockImplementation(async () => {
      activeCalls += 1;
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls);
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeCalls -= 1;
      return { message: "ok", plan: "pro" };
    });

    for (const id of ["conn-1", "conn-2", "conn-3", "conn-4", "conn-5"]) {
      providerConnectionById.set(id, {
        id,
        provider: "codex",
        authType: "oauth",
        accessToken: "token",
        refreshToken: "refresh",
        providerSpecificData: {},
      });
    }

    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");

    const requests = ["conn-1", "conn-2", "conn-3", "conn-4", "conn-5"].map((connectionId) => (
      GET(new Request(`http://localhost/api/usage/${connectionId}`), {
        params: Promise.resolve({ connectionId }),
      })
    ));
    const responses = await Promise.all(requests);

    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(maxActiveCalls).toBeLessThanOrEqual(3);
  });

  it("times out queued memory jobs that wait too long", async () => {
    process.env.USAGE_QUEUE_CONCURRENCY = "1";
    process.env.USAGE_QUEUE_WAIT_TIMEOUT_MS = "1000";

    const first = runUsageRefreshJob("conn-a", async () => {
      await new Promise((resolve) => setTimeout(resolve, 1100));
      return "first";
    });

    const second = runUsageRefreshJob("conn-b", async () => "second");

    await expect(second).rejects.toMatchObject({
      message: expect.stringContaining("timed out"),
      status: 504,
    });

    await expect(first).resolves.toBe("first");
  });

  it("rejects new queued memory jobs when queue is overloaded", async () => {
    process.env.USAGE_QUEUE_CONCURRENCY = "1";
    process.env.USAGE_QUEUE_MAX_QUEUED = "1";
    process.env.USAGE_QUEUE_WAIT_TIMEOUT_MS = "5000";

    const first = runUsageRefreshJob("conn-a", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return "first";
    });

    const second = runUsageRefreshJob("conn-b", async () => "second");
    const third = runUsageRefreshJob("conn-c", async () => "third");

    await expect(third).rejects.toMatchObject({
      message: expect.stringContaining("overloaded"),
      status: 503,
    });

    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
  });
});
