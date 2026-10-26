import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  nextResponse: Symbol("next"),
  jsonResponse: vi.fn((body, init) => ({
    status: init?.status || 200,
    body,
  })),
  getSettings: vi.fn(),
  validateApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    next: vi.fn(() => mocks.nextResponse),
    json: mocks.jsonResponse,
    redirect: vi.fn((url) => ({ status: 307, url })),
  },
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  validateApiKey: mocks.validateApiKey,
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

vi.mock("@/lib/auth/dashboardSession", () => ({
  verifyDashboardAuthToken: mocks.verifyDashboardAuthToken,
}));

const { proxy } = await import("../../src/dashboardGuard.js");

function request(pathname, method = "GET", headers = {}) {
  const normalizedHeaders = new Headers(headers);
  return {
    method,
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers: normalizedHeaders,
    cookies: { get: vi.fn(() => undefined) },
    url: `http://localhost${pathname}`,
  };
}

describe("dashboard guard headroom public endpoints (#2965)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  });

  it("allows GET /api/headroom/status without auth", async () => {
    const res = await proxy(request("/api/headroom/status", "GET"));
    expect(res).toBe(mocks.nextResponse);
  });

  it("allows GET /api/headroom/extras without auth so dashboard displays installed state", async () => {
    const res = await proxy(request("/api/headroom/extras", "GET"));
    expect(res).toBe(mocks.nextResponse);
  });

  it("rejects POST /api/headroom/extras without auth (installing packages requires auth)", async () => {
    const res = await proxy(request("/api/headroom/extras", "POST"));
    expect(res.status).toBe(401);
  });

  it("rejects DELETE /api/headroom/extras without auth (uninstalling packages requires auth)", async () => {
    const res = await proxy(request("/api/headroom/extras", "DELETE"));
    expect(res.status).toBe(401);
  });
});
