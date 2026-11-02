import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({
    status: init?.status || 200,
    body,
  })),
  cookies: vi.fn(),
  getSettings: vi.fn(),
  isOidcConfigured: vi.fn(),
  getDashboardAuthSession: vi.fn(),
  countPasskeys: vi.fn(),
  countRemotePasskeys: vi.fn(),
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
  countPasskeys: mocks.countPasskeys,
  countRemotePasskeys: mocks.countRemotePasskeys,
}));

vi.mock("@/dashboardGuard", () => ({
  isLocalRequest: mocks.isLocalRequest,
}));

vi.mock("@/lib/auth/oidc", () => ({
  isOidcConfigured: mocks.isOidcConfigured,
}));

vi.mock("@/lib/auth/dashboardSession", () => ({
  getDashboardAuthSession: mocks.getDashboardAuthSession,
}));

const { GET } = await import("../../src/app/api/auth/status/route.js");

describe("GET /api/auth/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireLogin: true, authMode: "password" });
    mocks.cookies.mockResolvedValue({ get: vi.fn(() => ({ value: "session-token" })) });
    mocks.isOidcConfigured.mockReturnValue(false);
    mocks.countPasskeys.mockResolvedValue(0);
    mocks.countRemotePasskeys.mockResolvedValue(0);
    mocks.isLocalRequest.mockReturnValue(false);
  });

  it("reports an authenticated session when the auth cookie is valid", async () => {
    mocks.getDashboardAuthSession.mockResolvedValue({ authenticated: true });

    const response = await GET();

    expect(response.body.authenticated).toBe(true);
    expect(mocks.getDashboardAuthSession).toHaveBeenCalledWith("session-token");
  });

  it("reports unauthenticated when the auth cookie is invalid", async () => {
    mocks.getDashboardAuthSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.body.authenticated).toBe(false);
  });

  it("fails closed when status dependencies throw", async () => {
    mocks.getSettings.mockRejectedValue(new Error("database unavailable"));

    const response = await GET();

    expect(response.body.authenticated).toBe(false);
    expect(response.body.requireLogin).toBe(true);
  });

  it("reports passkey mode off by default without touching the passkey table", async () => {
    mocks.getDashboardAuthSession.mockResolvedValue(null);

    const response = await GET({ headers: new Headers() });

    expect(response.body.passkeyMode).toBe("off");
    expect(response.body.passkeyAvailable).toBe(false);
    expect(response.body.passwordLoginAllowed).toBe(true);
    expect(mocks.countPasskeys).not.toHaveBeenCalled();
  });

  it("offers passkeys without leaking how many are enrolled", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: true, passkeyMode: "on" });
    mocks.countPasskeys.mockResolvedValue(3);
    mocks.getDashboardAuthSession.mockResolvedValue(null);

    const response = await GET({ headers: new Headers() });

    expect(response.body.passkeyMode).toBe("on");
    expect(response.body.passkeyAvailable).toBe(true);
    expect(response.body.passwordLoginAllowed).toBe(true);
    expect(Object.values(response.body)).not.toContain(3);
    expect(Object.keys(response.body).some((k) => /count/i.test(k))).toBe(false);
  });

  it("disallows remote password login in passkey-only mode", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: true, passkeyMode: "only" });
    mocks.countPasskeys.mockResolvedValue(1);
    mocks.countRemotePasskeys.mockResolvedValue(1);
    mocks.getDashboardAuthSession.mockResolvedValue(null);

    const response = await GET({ headers: new Headers() });

    expect(response.body.passkeyMode).toBe("only");
    expect(response.body.passwordLoginAllowed).toBe(false);
  });

  it("keeps password login for local requests in passkey-only mode", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: true, passkeyMode: "only" });
    mocks.countPasskeys.mockResolvedValue(1);
    mocks.countRemotePasskeys.mockResolvedValue(1);
    mocks.isLocalRequest.mockReturnValue(true);
    mocks.getDashboardAuthSession.mockResolvedValue(null);

    const response = await GET({ headers: new Headers() });

    expect(response.body.passwordLoginAllowed).toBe(true);
  });

  it("treats passkey-only with no enrolled passkeys as passkey + password", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: true, passkeyMode: "only" });
    mocks.countPasskeys.mockResolvedValue(0);
    mocks.getDashboardAuthSession.mockResolvedValue(null);

    const response = await GET({ headers: new Headers() });

    expect(response.body.passkeyMode).toBe("on");
    expect(response.body.passkeyAvailable).toBe(false);
    expect(response.body.passwordLoginAllowed).toBe(true);
  });

  it("keeps remote password login when the only passkeys are bound to localhost", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: true, passkeyMode: "only" });
    mocks.countPasskeys.mockResolvedValue(1);
    mocks.countRemotePasskeys.mockResolvedValue(0);
    mocks.getDashboardAuthSession.mockResolvedValue(null);

    const response = await GET({ headers: new Headers() });

    expect(response.body.passkeyMode).toBe("on");
    expect(response.body.passwordLoginAllowed).toBe(true);
  });

  it("hides passkey sign-in while SSO-only login is enforced", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: true, passkeyMode: "on", authMode: "sso", ssoType: "oidc" });
    mocks.isOidcConfigured.mockReturnValue(true);
    mocks.countPasskeys.mockResolvedValue(2);
    mocks.getDashboardAuthSession.mockResolvedValue(null);

    const response = await GET({ headers: new Headers() });

    expect(response.body.passkeyMode).toBe("off");
    expect(response.body.passkeyAvailable).toBe(false);
  });

  it("labels passkey sessions", async () => {
    mocks.getDashboardAuthSession.mockResolvedValue({ authenticated: true, passkey: true, passkeyName: "MacBook" });

    const response = await GET({ headers: new Headers() });

    expect(response.body.loginMethod).toBe("Passkey");
    expect(response.body.displayName).toBe("MacBook");
    expect(response.body.passkeyLogin).toBe(true);
  });

  it("keeps the fallback shape in sync with passkey fields", async () => {
    mocks.getSettings.mockRejectedValue(new Error("database unavailable"));

    const response = await GET();

    expect(response.body.passkeyMode).toBe("off");
    expect(response.body.passkeyAvailable).toBe(false);
    expect(response.body.passwordLoginAllowed).toBe(true);
    expect(response.body.passkeyLogin).toBe(false);
  });
});
