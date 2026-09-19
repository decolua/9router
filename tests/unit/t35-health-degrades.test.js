// T3.5 — degradation contract: a health view that 500s because ONE source is
// unreadable is useless, so every source fails on its own and the failure is
// reported instead of hidden. Nothing here can take an action either way.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

const fakes = vi.hoisted(() => ({
  getUsageHistory: vi.fn(),
  getRequestDetails: vi.fn(),
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  breakers: [],
}));

vi.mock("@/lib/usageDb", () => ({
  getUsageHistory: fakes.getUsageHistory,
  getRequestDetails: fakes.getRequestDetails,
}));

vi.mock("@/lib/db/index.js", () => ({
  getProviderConnections: fakes.getProviderConnections,
  getSettings: fakes.getSettings,
}));

vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardAuthToken: vi.fn(async () => true),
}));

vi.mock("@/lib/modelSync/connectionCatalog.js", () => ({
  catalogStatus: () => "never-synced",
  getConnectionCatalog: () => ({ models: [], lastSuccessAt: null, lastError: null }),
}));

vi.mock("open-sse/utils/circuitBreaker.js", () => ({
  getAllCircuitBreakerStatuses: () => fakes.breakers,
}));

const { GET } = await import("@/app/api/health/providers/route.js");

const request = (query = "") => ({
  url: `http://localhost/api/health/providers${query}`,
  cookies: { get: (n) => (n === "auth_token" ? { value: "jwt" } : undefined) },
});

beforeEach(() => {
  vi.clearAllMocks();
  fakes.getSettings.mockResolvedValue({ requireLogin: true });
  fakes.getProviderConnections.mockResolvedValue([]);
  fakes.breakers = [];
});

describe("t35 matrix — partial source failure", () => {
  it("still answers 200 with the traffic view when requestDetails is unreadable", async () => {
    fakes.getUsageHistory.mockResolvedValue([
      { provider: "p-ok", model: "m-1", timestamp: new Date().toISOString(), cost: 0, status: "ok" },
    ]);
    fakes.getRequestDetails.mockRejectedValue(new Error("SQLITE_BUSY: database is locked"));

    const res = await GET(request("?range=1h"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const prov = body.providers.find((p) => p.provider === "p-ok");
    expect(prov.requests).toBe(1);
    expect(prov.observed).toBe(0);
    expect(prov.successRate).toBe(null);
    // the missing source is named, not silently rendered as an empty column
    expect(body.sources.readFailures).toHaveLength(1);
    expect(body.sources.readFailures[0]).toMatch(/requestDetails: SQLITE_BUSY/);
  });

  it("survives a usageHistory failure and keeps the outcome view", async () => {
    fakes.getUsageHistory.mockRejectedValue(new Error("disk I/O error"));
    fakes.getRequestDetails.mockResolvedValue({
      details: [{ provider: "p-ok", model: "m-1", timestamp: new Date().toISOString(), status: "error", latency: { total: 900 } }],
      pagination: { totalItems: 1 },
    });

    const res = await GET(request("?range=24h"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const cell = body.providers.find((p) => p.provider === "p-ok").models.find((m) => m.model === "m-1");
    expect(cell.observed).toBe(1);
    expect(cell.failed).toBe(1);
    expect(cell.successRate).toBe(0);
    expect(cell.avgLatencyMs).toBe(900);
    expect(body.sources.readFailures[0]).toMatch(/usageHistory: disk I\/O error/);
  });

  it("answers an empty matrix (not a 500) when every read fails", async () => {
    fakes.getUsageHistory.mockRejectedValue(new Error("boom-a"));
    fakes.getRequestDetails.mockRejectedValue(new Error("boom-b"));
    fakes.getProviderConnections.mockRejectedValue(new Error("boom-c"));

    const res = await GET(request("?range=7d"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.providers).toEqual([]);
    expect(body.status).toBe("unknown");
    expect(body.sources.readFailures).toHaveLength(3);
  });

  it("keeps the unauthenticated caller out even when the sources are fine", async () => {
    const { verifyDashboardAuthToken } = await import("@/lib/auth/dashboardSession");
    verifyDashboardAuthToken.mockResolvedValueOnce(false);
    fakes.getSettings.mockResolvedValue({ requireLogin: true });
    const res = await GET({
      url: "http://localhost/api/health/providers",
      cookies: { get: () => undefined },
    });
    expect(res.status).toBe(401);
  });
});
