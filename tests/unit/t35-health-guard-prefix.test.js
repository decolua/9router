// T3.5 finding, pinned as an executable statement — UPDATED BY F38.
//
// T3.5 discovered that dashboardGuard's public allow-list matched entries as
// `pathname === p || pathname.startsWith(p + "/")`, so the "/api/health"
// liveness entry also let `/api/health/providers` through with no cookie and
// no API key — that is why the route self-gates in
// src/app/api/health/providers/route.js.
//
// F38 fixed the guard: allow-list entries are matched EXACTLY (trailing slash
// aside), so /api/health/providers is now deny-by-default at the guard too.
// The route keeps its self-auth as defense-in-depth. The original "leaks
// without auth" assertion is retired — it encoded the vulnerable prefix.
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  nextResponse: Symbol("next"),
  jsonResponse: vi.fn((body, init) => ({ status: init?.status || 200, body })),
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

function request(pathname) {
  return {
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers: new Headers({ host: "example.test" }),
    cookies: { get: vi.fn(() => undefined) },
    method: "GET",
    url: `http://localhost${pathname}`,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // login required, no valid session anywhere in the graph
  mocks.getSettings.mockResolvedValue({ requireLogin: true });
  mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  mocks.validateApiKey.mockResolvedValue(false);
  mocks.getConsistentMachineId.mockResolvedValue("nope");
});

describe("t35 — dashboardGuard behaviour on /api/health children (F38: exact match)", () => {
  it("lets /api/health (liveness) through, as designed", async () => {
    expect(await proxy(request("/api/health"))).toBe(mocks.nextResponse);
  });

  it("no longer lets /api/health/providers through WITHOUT auth (prefix leak fixed by F38)", async () => {
    const res = await proxy(request("/api/health/providers"));
    expect(res.status).toBe(401);
  });

  it("lets /api/health/providers through for a logged-in session (route still answers T3.5 callers)", async () => {
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
    expect(await proxy(request("/api/health/providers"))).toBe(mocks.nextResponse);
  });

  it("lets /api/health/providers through when requireLogin=false", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    expect(await proxy(request("/api/health/providers"))).toBe(mocks.nextResponse);
  });

  it("keeps an unrelated /api/* route behind the deny-by-default branch", async () => {
    const res = await proxy(request("/api/usage/stats"));
    expect(res.status).toBe(401);
  });
});
