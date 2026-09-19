// F21'/T1.6-M2 + T1.3-F-4: the update/shutdown routes spawn processes and run
// `npm i -g`, and the cli-tools *-settings routes write env JSON into HOME — all of
// them were reachable from any LAN peer (JWT, or NO credential at all once
// requireLogin=false) because the server binds 0.0.0.0 by default. They must be
// local-only: CLI token or loopback socket + auth. GETs on *-settings keep working
// remotely so the dashboard still renders current config.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

const PEER_TOKEN = "peer-token-fixture";
const CLI_TOKEN = "cli-token";

function request(pathname, method, headers = {}) {
  return {
    method,
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers: new Headers(headers),
    cookies: { get: vi.fn(() => undefined) },
    url: `http://localhost${pathname}`,
  };
}

// Provenance the guard can trust: custom-server.js stamped the real peer address.
const REMOTE = { "x-9r-real-ip": "10.1.2.3", "x-9r-peer-token": PEER_TOKEN, host: "10.0.0.9:20128" };
const LOOPBACK = { "x-9r-real-ip": "127.0.0.1", "x-9r-peer-token": PEER_TOKEN, host: "localhost:20128" };

const originalNodeEnv = process.env.NODE_ENV;

describe("local-only gating for host-mutating routes (F21')", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NINEROUTER_PEER_TOKEN = PEER_TOKEN;
    process.env.NODE_ENV = "production";
    // Worst-case posture from F-5: requireLogin=false means every D-class route is
    // open to any peer with no credential at all.
    mocks.getSettings.mockResolvedValue({ requireLogin: false });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue(CLI_TOKEN);
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.NINEROUTER_PEER_TOKEN;
  });

  it.each(["/api/version/update", "/api/version/shutdown"])(
    "403s a non-loopback POST to %s even with a valid JWT",
    async (pathname) => {
      const response = await proxy(request(pathname, "POST", REMOTE));

      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Local only: CLI token required");
    }
  );

  it.each([
    "/api/cli-tools/claude-settings",
    "/api/cli-tools/codex-settings",
    "/api/cli-tools/cline-settings",
    "/api/cli-tools/copilot-settings",
    "/api/cli-tools/deepseek-tui-settings",
    "/api/cli-tools/droid-settings",
    "/api/cli-tools/grok-build-settings",
    "/api/cli-tools/hermes-settings",
    "/api/cli-tools/jcode-settings",
    "/api/cli-tools/kilo-settings",
    "/api/cli-tools/openclaw-settings",
    "/api/cli-tools/opencode-settings",
  ])("403s a non-loopback POST writing env to HOME via %s", async (pathname) => {
    const response = await proxy(request(pathname, "POST", REMOTE));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Local only: CLI token required");
  });

  it("403s a non-loopback DELETE (settings reset is still a host write)", async () => {
    const response = await proxy(request("/api/cli-tools/claude-settings", "DELETE", REMOTE));

    expect(response.status).toBe(403);
  });

  it("403s a non-loopback PATCH (opencode-settings supports PATCH)", async () => {
    const response = await proxy(request("/api/cli-tools/opencode-settings", "PATCH", REMOTE));

    expect(response.status).toBe(403);
  });

  it("leaves remote GET on cli-tools settings alone (dashboard renders it)", async () => {
    const response = await proxy(request("/api/cli-tools/claude-settings", "GET", REMOTE));

    expect(response).toBe(mocks.nextResponse);
  });

  it("leaves non-settings cli-tools routes on the old policy", async () => {
    const statuses = await proxy(request("/api/cli-tools/all-statuses", "GET", REMOTE));
    const probe = await proxy(request("/api/cli-tools/cowork-mcp-tools", "POST", REMOTE));

    expect(statuses).toBe(mocks.nextResponse);
    expect(probe).toBe(mocks.nextResponse);
  });

  it("serves a loopback authenticated POST to the gated routes", async () => {
    expect(await proxy(request("/api/version/update", "POST", LOOPBACK))).toBe(mocks.nextResponse);
    expect(await proxy(request("/api/version/shutdown", "POST", LOOPBACK))).toBe(mocks.nextResponse);
    expect(await proxy(request("/api/cli-tools/claude-settings", "POST", LOOPBACK))).toBe(mocks.nextResponse);
  });

  it("keeps GET /api/version public and untouched by the new prefixes", async () => {
    expect(await proxy(request("/api/version", "GET", REMOTE))).toBe(mocks.nextResponse);
  });

  it("update/shutdown still require a credential even from loopback (ALWAYS_PROTECTED kept)", async () => {
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);

    const response = await proxy(request("/api/version/update", "POST", LOOPBACK));

    expect(response.status).toBe(401);
  });

  it("does not treat a spoofed local as access (no peer-token proof)", async () => {
    const response = await proxy(request("/api/version/update", "POST", {
      host: "localhost:20128",
      "x-9r-real-ip": "127.0.0.1",
    }));

    expect(response.status).toBe(403);
  });
});
