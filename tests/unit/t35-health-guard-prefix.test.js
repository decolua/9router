// T3.5 finding, pinned as an executable statement.
//
// The task brief assumed "a route under /api/* is deny-by-default, no extra
// config". That is true for /api/* in general — but NOT for children of
// /api/health: dashboardGuard's public allow-list is matched as
// `pathname === p || pathname.startsWith(p + "/")`, so the "/api/health"
// liveness entry also lets `/api/health/providers` through with no cookie and
// no API key. This file proves the prefix behaviour (and that the exact
// `/api/health` entry is otherwise unchanged), which is why
// src/app/api/health/providers/route.js authenticates itself.
//
// Fixing the prefix match itself belongs to F21' (owner of dashboardGuard.js);
// it would mean changing PUBLIC_API_PATHS matching for every allow-list entry,
// which is a wider blast radius than this read-only feature should carry.
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

describe("t35 — dashboardGuard prefix behaviour on /api/health children", () => {
  it("lets /api/health (liveness) through, as designed", async () => {
    expect(await proxy(request("/api/health"))).toBe(mocks.nextResponse);
  });

  it("also lets /api/health/providers through WITHOUT auth — the health matrix must self-gate", async () => {
    expect(await proxy(request("/api/health/providers"))).toBe(mocks.nextResponse);
    // no auth was even attempted for this path
    expect(mocks.verifyDashboardAuthToken).not.toHaveBeenCalled();
  });

  it("keeps an unrelated /api/* route behind the deny-by-default branch", async () => {
    const res = await proxy(request("/api/usage/stats"));
    expect(res.status).toBe(401);
  });
});
