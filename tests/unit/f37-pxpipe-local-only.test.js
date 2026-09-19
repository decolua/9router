// F37 (finding F32/F-32-A): /api/pxpipe/install and /api/pxpipe/start ran
// `npm install pxpipe-proxy@latest` and import() the result inside the gateway
// process. They were not in LOCAL_ONLY_PATHS, so with requireLogin=false any
// remote peer / tunnel visitor got RCE-equivalent code execution as the server
// user. The mutating POSTs of the pxpipe family (install, start, stop, restart,
// health) must be local-only (CLI token or loopback socket + auth, same policy
// as version/update from F21′); read GETs (status, logs, stats, health mirror)
// stay on the normal authenticated deny-by-default path so a dashboard opened
// from the LAN still renders.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";

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
const { buildInstallArgs, npmSearchPath, PXPIPE_PACKAGE } = await import("../../src/lib/pxpipe/install.js");

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

describe("F37: pxpipe mutating routes are local-only (F-32-A)", () => {
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

  it.each([
    "/api/pxpipe/install",
    "/api/pxpipe/start",
    "/api/pxpipe/stop",
    "/api/pxpipe/restart",
    "/api/pxpipe/health",
  ])("403s a non-loopback POST to %s even with requireLogin=false", async (pathname) => {
    const response = await proxy(request(pathname, "POST", REMOTE));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Local only: CLI token required");
  });

  it("403s a non-loopback DELETE on the same family (write method, not just POST)", async () => {
    const response = await proxy(request("/api/pxpipe/restart", "DELETE", REMOTE));

    expect(response.status).toBe(403);
  });

  it("403s a spoofed-local install POST (no peer-token proof)", async () => {
    const response = await proxy(request("/api/pxpipe/install", "POST", {
      host: "localhost:20128",
      "x-9r-real-ip": "127.0.0.1",
    }));

    expect(response.status).toBe(403);
  });

  it("serves a loopback authenticated POST (non-vacuous guard)", async () => {
    expect(await proxy(request("/api/pxpipe/install", "POST", LOOPBACK))).toBe(mocks.nextResponse);
    expect(await proxy(request("/api/pxpipe/start", "POST", LOOPBACK))).toBe(mocks.nextResponse);
    expect(await proxy(request("/api/pxpipe/stop", "POST", LOOPBACK))).toBe(mocks.nextResponse);
    expect(await proxy(request("/api/pxpipe/restart", "POST", LOOPBACK))).toBe(mocks.nextResponse);
    expect(await proxy(request("/api/pxpipe/health", "POST", LOOPBACK))).toBe(mocks.nextResponse);
  });

  it("allows a remote POST only with the machine CLI token (installed dashboard automation)", async () => {
    const response = await proxy(request("/api/pxpipe/start", "POST", {
      ...REMOTE,
      "x-9r-cli-token": CLI_TOKEN,
    }));

    expect(response).toBe(mocks.nextResponse);
  });

  it.each([
    "/api/pxpipe/status",
    "/api/pxpipe/logs",
    "/api/pxpipe/stats",
    "/api/pxpipe/health",
  ])("leaves remote GET on %s on the normal authenticated policy", async (pathname) => {
    const response = await proxy(request(pathname, "GET", REMOTE));

    expect(response).toBe(mocks.nextResponse);
  });
});

describe("F37: npm install hardening (install.js)", () => {
  it("spawns npm with --ignore-scripts (postinstall vector killed)", () => {
    expect(buildInstallArgs()).toContain("--ignore-scripts");
  });

  it("installs a pinned pxpipe-proxy version, not the mutable @latest tag", () => {
    const spec = buildInstallArgs().find((a) => a.startsWith(`${PXPIPE_PACKAGE}@`));
    expect(spec).toBeDefined();
    expect(spec).toMatch(/^pxpipe-proxy@\d+\.\d+\.\d+$/);
  });

  it("resolves npm from the inherited PATH first — no pre-pended user-writable dir", () => {
    const inherited = `first${path.delimiter}second`;
    const searchPath = npmSearchPath(inherited);

    expect(searchPath.startsWith(`${inherited}${path.delimiter}`)).toBe(true);

    const home = process.env.HOME || process.env.USERPROFILE || "";
    const appended = searchPath.split(path.delimiter).slice(2);
    // ~/.local/bin (unix) and %APPDATA%\npm (win) are user-writable and must not
    // be pre-pended: a same-user file write could hijack the npm binary (F-32-C).
    expect(home ? appended.some((p) => p.startsWith(home)) : false).toBe(false);
  });
});
