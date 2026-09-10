import { describe, it, expect, vi, beforeEach } from "vitest";

// `PROTECTED_API_PATHS` sat in dashboardGuard.js with a comment describing an
// access rule -- "Require auth, but allow through if requireLogin is disabled"
// -- and nothing read it. A list shaped like a policy, enforced by nobody, is
// worse than no list: adding a path to it looks like protecting that path.
//
// The rule it described is real; it is the deny-by-default arm for `/api/*`
// that runs after the public allow-list. These pin that arm against the exact
// paths the dead list named, so removing the list is safe and the rule is held
// by a test instead of by a comment.

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

const request = (pathname, headers = {}) => ({
  nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
  headers: new Headers(headers),
  cookies: { get: vi.fn(() => undefined) },
  url: `http://localhost${pathname}`,
});

// Every path the dead list named.
const FORMERLY_LISTED = [
  "/api/settings",
  "/api/keys",
  "/api/providers",
  "/api/provider-nodes",
  "/api/proxy-pools",
  "/api/combos",
  "/api/models",
  "/api/usage",
  "/api/oauth",
  "/api/cloud",
  "/api/media-providers",
  "/api/pricing",
  "/api/tags",
  "/api/cli-tools",
  "/api/mcp",
  "/api/translator",
  "/api/tunnel",
];

describe("/api/* deny-by-default", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NINEROUTER_PEER_TOKEN;
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.verifyDashboardAuthToken.mockResolvedValue(null);
    mocks.validateApiKey.mockResolvedValue(null);
  });

  it.each(FORMERLY_LISTED)("rejects an unauthenticated %s", async (path) => {
    const res = await proxy(request(path));
    expect(res.status).toBe(401);
  });

  it.each(FORMERLY_LISTED)("also rejects a child route under %s", async (path) => {
    // 401 from the deny-by-default arm, or 403 where a stricter local-only gate
    // runs first (/api/mcp/). Asserting only 401 would have called that stricter
    // answer a failure.
    const res = await proxy(request(`${path}/anything`));
    expect([401, 403]).toContain(res.status);
  });

  it("answers /api/mcp/ with the stricter local-only 403, not the generic 401", async () => {
    const res = await proxy(request("/api/mcp/servers"));
    expect(res.status).toBe(403);
  });

  it("rejects a path that was never on the list either", async () => {
    // The rule is the prefix `/api/`, not membership of any list -- which is
    // why the list could be deleted without changing an answer.
    const res = await proxy(request("/api/some-route-invented-today"));
    expect(res.status).toBe(401);
  });

  it("lets the documented requireLogin=false escape hatch through", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    const res = await proxy(request("/api/settings"));
    expect(res).toBe(mocks.nextResponse);
  });

  it("keeps the public allow-list public", async () => {
    // /api/settings/require-login is public even though /api/settings is not.
    const res = await proxy(request("/api/settings/require-login"));
    expect(res).toBe(mocks.nextResponse);
  });
});
