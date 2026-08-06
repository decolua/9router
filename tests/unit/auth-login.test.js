import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({
    status: init?.status ?? 200,
    body,
    headers: init?.headers,
  })),
  cookies: vi.fn(),
  getSettings: vi.fn(),
  setDashboardAuthCookie: vi.fn(),
  isOidcConfigured: vi.fn(),
  checkLock: vi.fn(),
  recordFail: vi.fn(),
  recordSuccess: vi.fn(),
  getClientIp: vi.fn(),
  isLocalRequest: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

vi.mock("next/headers", () => ({
  cookies: mocks.cookies,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
}));

vi.mock("@/lib/auth/dashboardSession", () => ({
  setDashboardAuthCookie: mocks.setDashboardAuthCookie,
}));

vi.mock("@/lib/auth/oidc", () => ({
  isOidcConfigured: mocks.isOidcConfigured,
}));

vi.mock("@/lib/auth/loginLimiter", () => ({
  checkLock: mocks.checkLock,
  recordFail: mocks.recordFail,
  recordSuccess: mocks.recordSuccess,
  getClientIp: mocks.getClientIp,
}));

vi.mock("@/dashboardGuard", () => ({
  isLocalRequest: mocks.isLocalRequest,
}));

const { POST } = await import("../../src/app/api/auth/login/route.js");

function request(password = "123456") {
  return {
    headers: new Headers({ host: "router.example.com" }),
    json: vi.fn().mockResolvedValue({ password }),
  };
}

describe("POST /api/auth/login default password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("INITIAL_PASSWORD", "");
    mocks.cookies.mockResolvedValue({ set: vi.fn() });
    mocks.getSettings.mockResolvedValue({
      password: null,
      authMode: "password",
      tunnelDashboardAccess: true,
    });
    mocks.isOidcConfigured.mockReturnValue(false);
    mocks.checkLock.mockReturnValue({ locked: false });
    mocks.getClientIp.mockReturnValue("203.0.113.10");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects a remote default-password login without issuing a cookie", async () => {
    mocks.isLocalRequest.mockReturnValue(false);

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({ success: false, mustChangePassword: true });
    expect(mocks.cookies).not.toHaveBeenCalled();
    expect(mocks.setDashboardAuthCookie).not.toHaveBeenCalled();
  });

  it("keeps local default-password login available", async () => {
    mocks.isLocalRequest.mockReturnValue(true);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, mustChangePassword: false });
    expect(mocks.setDashboardAuthCookie).toHaveBeenCalledOnce();
  });
});
