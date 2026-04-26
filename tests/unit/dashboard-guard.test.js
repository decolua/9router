import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    next: () => ({ type: "next", status: 200 }),
    json: (body, init = {}) => ({ type: "json", body, status: init.status ?? 200 }),
    redirect: (url) => ({ type: "redirect", status: 307, location: String(url) }),
  },
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({ requireLogin: true, tunnelDashboardAccess: true })),
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: vi.fn(async () => "expected-cli-token"),
}));

vi.mock("jose", () => ({
  jwtVerify: vi.fn(async (token) => {
    if (token !== "valid-jwt") throw new Error("invalid jwt");
    return { payload: { sub: "user-1" } };
  }),
}));

function makeRequest(pathname, { host = "localhost:20128", cookieToken, cliToken } = {}) {
  const headers = new Map([["host", host]]);
  if (cliToken) headers.set("x-9r-cli-token", cliToken);

  return {
    nextUrl: { pathname },
    url: `http://${host}${pathname}`,
    headers: {
      get: (name) => headers.get(name.toLowerCase()) ?? null,
    },
    cookies: {
      get: (name) => {
        if (name !== "auth_token" || !cookieToken) return undefined;
        return { value: cookieToken };
      },
    },
  };
}

describe("dashboard guard hardening for always protected endpoints", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("returns 401 for localhost access to always-protected endpoint without JWT or CLI token", async () => {
    const { proxy } = await import("../../src/dashboardGuard.ts");
    const req = makeRequest("/api/shutdown", { host: "localhost:20128" });

    const response = await proxy(req);

    expect(response.type).toBe("json");
    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "Unauthorized" });
  });

  it("allows localhost access to always-protected endpoint with valid CLI token", async () => {
    const { proxy } = await import("../../src/dashboardGuard.ts");
    const req = makeRequest("/api/shutdown", {
      host: "localhost:20128",
      cliToken: "expected-cli-token",
    });

    const response = await proxy(req);

    expect(response.type).toBe("next");
    expect(response.status).toBe(200);
  });

  it("allows always-protected endpoint with valid JWT", async () => {
    const { proxy } = await import("../../src/dashboardGuard.ts");
    const req = makeRequest("/api/settings/database", {
      host: "localhost:20128",
      cookieToken: "valid-jwt",
    });

    const response = await proxy(req);

    expect(response.type).toBe("next");
    expect(response.status).toBe(200);
  });
});
