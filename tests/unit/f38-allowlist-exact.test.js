// F38 — the dashboardGuard public allow-list must match EXACTLY (path === entry
// or path === entry + "/"), never as an open prefix.
//
// Before the fix, `isPublicApi()` matched every allow-list entry as
// `pathname === p || pathname.startsWith(p + "/")`, so ANY child of a public
// entry bypassed the guard with no credentials: a hypothetical /api/health/admin
// would ship public, and the real /api/health/providers was leaking through
// (it survives today only because T3.5 made it self-authenticate).
//
// The fix pins: children not explicitly listed are deny-by-default (401);
// exact entries and their trailing-slash form still pass; the SSO login-flow
// children that legitimately need to stay public (/api/auth/oidc/start|callback,
// /api/auth/saml/start|acs|metadata) are now listed explicitly; the self-gated
// */test routes drop out of the guard bypass (their route-level auth remains);
// and the LLM families (/v1/*, /api/v1/*, ...) keep their prefix semantics.
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

function request(pathname, { method = "GET", headers = {} } = {}) {
  return {
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers: new Headers({ host: "router.example.com", ...headers }),
    cookies: { get: vi.fn(() => undefined) },
    method,
    url: `http://localhost${pathname}`,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Remote peer, login required, nothing valid presented — unless a test says otherwise.
  mocks.getSettings.mockResolvedValue({ requireLogin: true });
  mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  mocks.validateApiKey.mockResolvedValue(false);
  mocks.getConsistentMachineId.mockResolvedValue("nope");
});

describe("f38 — allow-list children no longer leak through prefix matching", () => {
  it("401s an unlisted child of /api/health (today: RED — passes as public)", async () => {
    const res = await proxy(request("/api/health/admin"));
    expect(res.status).toBe(401);
  });

  it("401s /api/health/providers without credentials (the T3.5 leak)", async () => {
    const res = await proxy(request("/api/health/providers"));
    expect(res.status).toBe(401);
    // no auth bypass shortcut: the path is NOT treated as public
    expect(res.body.error).toBe("Unauthorized");
  });

  it("still lets /api/health/providers through for a logged-in session", async () => {
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
    expect(await proxy(request("/api/health/providers"))).toBe(mocks.nextResponse);
  });

  it("still lets /api/health/providers through when requireLogin=false", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    expect(await proxy(request("/api/health/providers"))).toBe(mocks.nextResponse);
  });

  it("401s unlisted children of every other allow-list entry", async () => {
    for (const pathname of [
      "/api/auth/status/details",
      "/api/auth/login/../status",
      "/api/version/changelog",
      "/api/init/retry",
      "/api/locale/set",
      "/api/settings/require-login/toggle",
    ]) {
      const res = await proxy(request(pathname));
      expect(res.status, pathname).toBe(401);
    }
  });

  it("does not match a mere string-prefix sibling (/api/healthz)", async () => {
    const res = await proxy(request("/api/healthz"));
    expect(res.status).toBe(401);
  });

  it("401s the self-gated */test SSO routes at the guard (route-level auth stays as defense)", async () => {
    expect((await proxy(request("/api/auth/oidc/test", { method: "POST" }))).status).toBe(401);
    expect((await proxy(request("/api/auth/saml/test", { method: "POST" }))).status).toBe(401);
    // …but a logged-in session still reaches them (they answer, guard does not block)
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
    expect(await proxy(request("/api/auth/oidc/test", { method: "POST" }))).toBe(mocks.nextResponse);
    expect(await proxy(request("/api/auth/saml/test", { method: "POST" }))).toBe(mocks.nextResponse);
  });
});

describe("f38 — exact entries keep working", () => {
  it("allows every exact allow-list entry with no credentials", async () => {
    for (const pathname of [
      "/api/health",
      "/api/init",
      "/api/locale",
      "/api/auth/login",
      "/api/auth/logout",
      "/api/auth/status",
      "/api/version",
      "/api/settings/require-login",
    ]) {
      expect(await proxy(request(pathname)), pathname).toBe(mocks.nextResponse);
    }
  });

  it("allows the trailing-slash form of an entry", async () => {
    expect(await proxy(request("/api/health/"))).toBe(mocks.nextResponse);
    expect(await proxy(request("/api/auth/status/"))).toBe(mocks.nextResponse);
  });

  it("keeps the explicitly-listed public SSO login-flow children reachable", async () => {
    // SSO start/callback/acs/metadata run BEFORE login — they must stay in the
    // allow-list as explicit exact entries (prefix entry "/api/auth/oidc|saml" is gone).
    expect(await proxy(request("/api/auth/oidc/start"))).toBe(mocks.nextResponse);
    expect(await proxy(request("/api/auth/oidc/callback"))).toBe(mocks.nextResponse);
    expect(await proxy(request("/api/auth/saml/start"))).toBe(mocks.nextResponse);
    expect(await proxy(request("/api/auth/saml/acs", { method: "POST" }))).toBe(mocks.nextResponse);
    expect(await proxy(request("/api/auth/saml/metadata"))).toBe(mocks.nextResponse);
  });

  it("keeps LLM API families prefix-matched (unchanged semantics)", async () => {
    mocks.validateApiKey.mockResolvedValue(true);
    const res = await proxy(request("/v1/deep/nested/path", { headers: { authorization: "Bearer sk-ok" } }));
    expect(res).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-ok");
  });
});
