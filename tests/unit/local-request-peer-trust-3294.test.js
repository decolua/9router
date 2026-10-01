// GHSA-pjm4-8fpg-f9p6 (#3294): `next start` leaves custom-server.js out of the request
// path, so x-9r-real-ip arrives straight from the client and a remote caller can claim to
// be loopback. Host is spoofable the same way, so it cannot be the production fallback.
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
const { getClientIp } = await import("../../src/lib/auth/loginLimiter.js");

const PEER_TOKEN = "peer-token-fixture";

function request(pathname, headers = {}) {
  return {
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers: new Headers(headers),
    cookies: { get: vi.fn(() => undefined) },
    url: `http://localhost${pathname}`,
  };
}

const originalNodeEnv = process.env.NODE_ENV;

describe("peer header trust", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NINEROUTER_PEER_TOKEN = PEER_TOKEN;
    process.env.NODE_ENV = "production";
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    delete process.env.NINEROUTER_PEER_TOKEN;
  });

  it("rejects a spoofed loopback peer IP that carries no trust proof", async () => {
    const response = await proxy(request("/api/v1/models", {
      host: "172.18.192.1:20140",
      "x-9r-real-ip": "127.0.0.1",
    }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("rejects a spoofed loopback peer IP carrying a wrong trust token", async () => {
    const response = await proxy(request("/api/v1/models", {
      host: "172.18.192.1:20140",
      "x-9r-real-ip": "127.0.0.1",
      "x-9r-peer-token": "guessed-token",
    }));

    expect(response.status).toBe(401);
  });

  it("rejects a spoofed loopback Host in production", async () => {
    const response = await proxy(request("/api/v1/models", { host: "localhost" }));

    expect(response.status).toBe(401);
  });

  it("rejects a spoofed loopback peer IP when the wrapper never booted", async () => {
    delete process.env.NINEROUTER_PEER_TOKEN;

    const response = await proxy(request("/api/v1/models", {
      host: "172.18.192.1:20140",
      "x-9r-real-ip": "127.0.0.1",
      "x-9r-peer-token": "any-token",
    }));

    expect(response.status).toBe(401);
  });

  it("keeps serving a genuinely local request stamped by the wrapper", async () => {
    const response = await proxy(request("/api/v1/models", {
      host: "localhost:20128",
      "x-9r-real-ip": "127.0.0.1",
      "x-9r-peer-token": PEER_TOKEN,
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  // A dual-stack listener reports loopback as ::ffff:127.0.0.1, which the old
  // split-on-first-colon check reduced to "".
  it.each(["::ffff:127.0.0.1", "::1", "[::1]", "127.0.0.1", "::FFFF:127.0.0.1"])(
    "treats %s as a loopback peer",
    async (peerIp) => {
      const response = await proxy(request("/api/v1/models", {
        host: "localhost:20128",
        "x-9r-real-ip": peerIp,
        "x-9r-peer-token": PEER_TOKEN,
      }));

      expect(response).toBe(mocks.nextResponse);
    }
  );

  it.each(["::ffff:10.204.111.34", "2001:db8::1", "[2001:db8::1]", "10.204.111.34"])(
    "refuses %s as a peer",
    async (peerIp) => {
      const response = await proxy(request("/api/v1/models", {
        host: "localhost:20128",
        "x-9r-real-ip": peerIp,
        "x-9r-peer-token": PEER_TOKEN,
      }));

      expect(response.status).toBe(401);
    }
  );

  it("still refuses a stamped non-loopback peer IP", async () => {
    const response = await proxy(request("/api/v1/models", {
      host: "localhost:20128",
      "x-9r-real-ip": "10.204.111.34",
      "x-9r-peer-token": PEER_TOKEN,
    }));

    expect(response.status).toBe(401);
  });

  it("blocks spoofed local-only routes that would otherwise spawn processes", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });

    const response = await proxy(request("/api/mcp/filesystem/sse", {
      host: "172.18.192.1:20140",
      "x-9r-real-ip": "127.0.0.1",
    }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Local only: CLI token required");
  });

  it("accepts the legacy Host fallback only in development", async () => {
    process.env.NODE_ENV = "development";

    const response = await proxy(request("/api/v1/models", { host: "localhost:20127" }));

    expect(response).toBe(mocks.nextResponse);
  });
});

describe("login limiter client IP", () => {
  beforeEach(() => {
    process.env.NINEROUTER_PEER_TOKEN = PEER_TOKEN;
    delete process.env.TRUST_PROXY;
  });

  afterEach(() => {
    delete process.env.NINEROUTER_PEER_TOKEN;
    delete process.env.TRUST_PROXY;
  });

  it("buckets spoofed peer IPs together so lockout cannot be rotated away", () => {
    const first = getClientIp(request("/api/auth/login", { "x-9r-real-ip": "1.1.1.1" }));
    const second = getClientIp(request("/api/auth/login", { "x-9r-real-ip": "2.2.2.2" }));

    expect(first).toBe("unknown");
    expect(second).toBe("unknown");
  });

  it("keys on the stamped peer IP when the wrapper proved it", () => {
    const ip = getClientIp(request("/api/auth/login", {
      "x-9r-real-ip": "203.0.113.9",
      "x-9r-peer-token": PEER_TOKEN,
    }));

    expect(ip).toBe("203.0.113.9");
  });

  it("still honours TRUST_PROXY for operators fronting 9router with a reverse proxy", () => {
    process.env.TRUST_PROXY = "true";

    const ip = getClientIp(request("/api/auth/login", { "x-forwarded-for": "198.51.100.7, 10.0.0.1" }));

    expect(ip).toBe("198.51.100.7");
  });
});
