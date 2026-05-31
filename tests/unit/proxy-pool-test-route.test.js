import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

const getProxyPoolById = vi.fn();
const updateProxyPool = vi.fn();
const testProxyUrl = vi.fn();

vi.mock("@/models", () => ({
  getProxyPoolById,
  updateProxyPool,
}));

vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl,
}));

vi.mock("undici", () => ({
  fetch: vi.fn(),
}));

const params = (id = "pool-1") => ({ params: Promise.resolve({ id }) });

describe("POST /api/proxy-pools/[id]/test", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getProxyPoolById.mockResolvedValue({
      id: "pool-1",
      type: "http",
      proxyUrl: "http://user:pass@127.0.0.1:7890",
    });
  });

  it("persists latency when a proxy test succeeds", async () => {
    testProxyUrl.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      elapsedMs: 321,
    });

    const { POST } = await import("@/app/api/proxy-pools/[id]/test/route");
    const res = await POST({}, params());
    const body = await res.json();

    expect(body).toMatchObject({ ok: true, elapsedMs: 321, status: 200 });
    expect(updateProxyPool).toHaveBeenCalledWith("pool-1", expect.objectContaining({
      testStatus: "active",
      lastError: null,
      lastLatencyMs: 321,
      isActive: true,
    }));
  });

  it("clears stale latency when a proxy test fails", async () => {
    testProxyUrl.mockResolvedValue({
      ok: false,
      status: 502,
      error: "Bad gateway",
      elapsedMs: 900,
    });

    const { POST } = await import("@/app/api/proxy-pools/[id]/test/route");
    const res = await POST({}, params());
    const body = await res.json();

    expect(body).toMatchObject({ ok: false, elapsedMs: 900, status: 502 });
    expect(updateProxyPool).toHaveBeenCalledWith("pool-1", expect.objectContaining({
      testStatus: "error",
      lastError: "Bad gateway",
      lastLatencyMs: null,
      isActive: false,
    }));
  });
});
