import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  getProviderConnections: vi.fn(),
  getProviderNodes: vi.fn(),
}));

vi.mock("@/dashboardGuard", () => ({ requireDashboardAdmin: mocks.guard }));
vi.mock("@/lib/db/index.js", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getProviderNodes: mocks.getProviderNodes,
}));

const { GET } = await import("../../src/app/api/usage/live/route.js");
const { getLiveRouteListenerCount, resetLiveRoutes, startLiveRoute } = await import("../../src/lib/observability/liveRoutes.js");

function request(signal) {
  return new Request("http://localhost/api/usage/live", { signal });
}

describe("GET /api/usage/live", () => {
  beforeEach(() => {
    resetLiveRoutes();
    mocks.guard.mockReset().mockResolvedValue(null);
    mocks.getProviderConnections.mockResolvedValue([{ id: "account-1", provider: "openai", name: "Demo", email: "demo@example.com" }]);
    mocks.getProviderNodes.mockResolvedValue([]);
  });

  it("returns an admin SSE snapshot first", async () => {
    startLiveRoute({ requestId: "live-1", startedAt: Date.now(), client: { name: "curl" } });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("event: snapshot");
    expect(first).toContain('"records"');
    await reader.cancel();
  });

  it("returns 403 for viewer and 401 for anonymous requests", async () => {
    mocks.guard.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Administrator required" }), { status: 403 }));
    expect((await GET(request())).status).toBe(403);
    mocks.guard.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }));
    expect((await GET(request())).status).toBe(401);
  });

  it("removes the listener when the client aborts", async () => {
    const controller = new AbortController();
    const response = await GET(request(controller.signal));
    expect(getLiveRouteListenerCount()).toBe(1);
    controller.abort();
    await response.body.cancel();
    expect(getLiveRouteListenerCount()).toBe(0);
  });
});
