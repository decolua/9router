import { beforeEach, describe, expect, it, vi } from "vitest";

// GET /api/models/router aggregates catalog, health, usage, latency, combos.
// Auth is inherited from dashboardGuard (/api/* deny-by-default); tested via
// the middleware proxy.
const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(async () => {}),
  getCombos: vi.fn(),
  getCustomModels: vi.fn(async () => []),
  getModelAliases: vi.fn(async () => ({})),
  getSettings: vi.fn(),
  validateApiKey: vi.fn(),
}));

vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/disabledModelsDb", () => ({
  getDisabledModels: vi.fn(async () => ({})),
}));
vi.mock("@/lib/db/repos/combosRepo.js", () => ({ getCombos: vi.fn(async () => []) }));
vi.mock("@/lib/db/repos/usageRepo.js", () => ({ getUsageHistory: vi.fn(async () => []) }));
vi.mock("@/lib/db/repos/requestDetailsRepo.js", () => ({
  getRequestDetails: vi.fn(async () => ({ details: [], pagination: {} })),
}));
vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardAuthToken: vi.fn(async () => false),
}));
vi.mock("@/lib/auth/trustedPeer", () => ({
  hasTrustedPeerHeaders: vi.fn(() => false),
}));
vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: vi.fn(async () => "test-token"),
}));

const { GET } = await import("../../src/app/api/models/router/route.js");
const { proxy } = await import("../../src/dashboardGuard.js");

function makeRequest(query = "") {
  const url = new URL(`https://router.test/api/models/router${query}`);
  return {
    url: url.toString(),
    headers: new Headers(),
    nextUrl: { pathname: url.pathname, searchParams: url.searchParams },
    cookies: { get: () => undefined },
  };
}

function makeProxyRequest(pathname, headers = {}) {
  const u = new URL(`https://router.test${pathname}`);
  return {
    url: u.toString(),
    nextUrl: { pathname: u.pathname, searchParams: u.searchParams },
    headers: new Headers(headers),
    cookies: { get: () => undefined },
  };
}

const tail = (m) => m.id.split("/").pop();

describe("GET /api/models/router — infra view shape & auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.getProviderConnections.mockResolvedValue([
      {
        id: "c1",
        provider: "deepseek",
        isActive: true,
        testStatus: "active",
        backoffLevel: 0,
        lastError: null,
        lastErrorAt: null,
        providerSpecificData: { enabledModels: ["deepseek-v4.1-flash", "deepseek-chat"] },
      },
    ]);
    db.getCombos.mockResolvedValue([]);
    db.getSettings.mockResolvedValue({ requireLogin: true });
    db.validateApiKey.mockResolvedValue(false);
  });

  it("returns the documented envelope with the expected keys", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.object).toBe("router.models");
    expect(body.period).toBe("24h");
    expect(typeof body.generatedAt).toBe("string");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBe(2);

    const rec = body.data[0];
    // Top-level keys
    expect(Object.keys(rec).sort()).toEqual(
      ["available", "capabilities", "context_length", "health", "id", "kind", "owned_by", "routing", "usage"].sort(),
    );
    // health keys
    expect(Object.keys(rec.health).sort()).toEqual(
      ["backoffLevel", "lastError", "lastErrorAt", "rateLimitedUntil", "status"].sort(),
    );
    // usage keys
    expect(Object.keys(rec.usage).sort()).toEqual(
      ["avgLatencyMs", "completionTokens", "cost", "errors", "promptTokens", "requests"].sort(),
    );
    // routing keys
    expect(Object.keys(rec.routing).sort()).toEqual(["combos", "primary"]);

    // Default healthy state
    expect(rec.available).toBe(true);
    expect(rec.health.status).toBe("active");
    expect(rec.health.rateLimitedUntil).toBeNull();
    expect(rec.health.lastError).toBeNull();
    expect(rec.usage.avgLatencyMs).toBeNull();
    expect(rec.routing.combos).toEqual([]);
  });

  it("marks a model as cooldown when a modelLock_* is active", async () => {
    const future = new Date(Date.now() + 60000).toISOString();
    db.getProviderConnections.mockResolvedValue([
      {
        id: "c1",
        provider: "deepseek",
        isActive: true,
        testStatus: "active",
        backoffLevel: 0,
        lastError: null,
        lastErrorAt: null,
        "modelLock_deepseek-v4.1-flash": future,
        providerSpecificData: { enabledModels: ["deepseek-v4.1-flash", "deepseek-chat"] },
      },
    ]);
    db.getCombos.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();

    const cooldown = body.data.find((m) => tail(m) === "deepseek-v4.1-flash");
    const healthy = body.data.find((m) => tail(m) === "deepseek-chat");

    expect(cooldown.available).toBe(false);
    expect(cooldown.health.status).toBe("cooldown");
    expect(cooldown.health.rateLimitedUntil).toBe(future);
    expect(healthy.health.status).toBe("active");
  });

  it("falls back to connection-level unavailable when testStatus is unavailable", async () => {
    db.getProviderConnections.mockResolvedValue([
      {
        id: "c1",
        provider: "deepseek",
        isActive: true,
        testStatus: "unavailable",
        backoffLevel: 2,
        lastError: "rate limit exceeded",
        lastErrorAt: new Date().toISOString(),
        providerSpecificData: { enabledModels: ["deepseek-v4.1-flash", "deepseek-chat"] },
      },
    ]);
    db.getCombos.mockResolvedValue([]);

    const res = await GET(makeRequest());
    const body = await res.json();

    for (const m of body.data) {
      expect(m.available).toBe(false);
      expect(m.health.status).toBe("unavailable");
      expect(m.health.backoffLevel).toBe(2);
      expect(m.health.lastError).toBe("rate limit exceeded");
    }
  });

  it("aggregates usage from usageHistory within the period", async () => {
    const ts = new Date().toISOString();
    vi.mocked(await import("@/lib/db/repos/usageRepo.js")).getUsageHistory.mockResolvedValue([
      {
        timestamp: ts,
        provider: "deepseek",
        model: "deepseek-v4.1-flash",
        cost: 0.01,
        status: "ok",
        tokens: { prompt_tokens: 10, completion_tokens: 5 },
      },
      {
        timestamp: ts,
        provider: "deepseek",
        model: "deepseek-v4.1-flash",
        cost: 0.02,
        status: "timeout",
        tokens: { prompt_tokens: 1, completion_tokens: 1 },
      },
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    const m = body.data.find((x) => tail(x) === "deepseek-v4.1-flash");
    expect(m.usage.requests).toBe(2);
    expect(m.usage.errors).toBe(1);
    expect(m.usage.promptTokens).toBe(11);
    expect(m.usage.completionTokens).toBe(6);
    expect(m.usage.cost).toBeCloseTo(0.03);
  });

  it("sets avgLatencyMs when requestDetails provide timing", async () => {
    const ts = new Date().toISOString();
    vi.mocked(await import("@/lib/db/repos/requestDetailsRepo.js")).getRequestDetails.mockResolvedValue({
      details: [
        { model: "deepseek/deepseek-v4.1-flash", latency: { total: 120, ttft: 50 } },
        { model: "deepseek/deepseek-v4.1-flash", latency: { total: 80, ttft: 40 } },
      ],
      pagination: {},
    });

    const res = await GET(makeRequest());
    const body = await res.json();

    const m = body.data.find((x) => tail(x) === "deepseek-v4.1-flash");
    expect(m.usage.avgLatencyMs).toBe(100); // (120 + 80) / 2
  });

  it("includes combo membership and primary flag", async () => {
    vi.mocked(await import("@/lib/db/repos/combosRepo.js")).getCombos.mockResolvedValue([
      {
        name: "test-combo",
        models: ["deepseek/deepseek-v4.1-flash", "deepseek/deepseek-chat"],
      },
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    const m1 = body.data.find((x) => tail(x) === "deepseek-v4.1-flash");
    const m2 = body.data.find((x) => tail(x) === "deepseek-chat");

    expect(m1.routing.combos).toEqual(["test-combo"]);
    expect(m2.routing.combos).toEqual(["test-combo"]);
    expect(m1.routing.primary).toBe(true);
    expect(m2.routing.primary).toBe(false);
  });

  it("accepts period=7d and rejects unknown periods", async () => {
    const ok7d = await GET(makeRequest("?period=7d"));
    expect(ok7d.status).toBe(200);
    expect((await ok7d.json()).period).toBe("7d");

    const bad = await GET(makeRequest("?period=30d"));
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.message).toContain("30d");
  });
});

describe("dashboardGuard proxy — /api/models/router requires auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.getSettings.mockResolvedValue({ requireLogin: true });
    db.validateApiKey.mockResolvedValue(false);
  });

  it("returns 401 when no JWT, CLI token, or API key", async () => {
    const res = await proxy(makeProxyRequest("/api/models/router"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("Unauthorized");
  });

  it("allows a valid CLI token", async () => {
    const res = await proxy(makeProxyRequest("/api/models/router", { "x-9r-cli-token": "test-token" }));
    expect(res.status).toBe(200); // NextResponse.next()
  });
});