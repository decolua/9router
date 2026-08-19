import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  nextResponse: Symbol("next"),
  jsonResponse: vi.fn((body, init) => ({
    status: init?.status || 200,
    body,
  })),
  getSettings: vi.fn(),
  validateApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
  getDashboardAuthSession: vi.fn(),
  getMeta: vi.fn(),
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
  getDashboardAuthSession: mocks.getDashboardAuthSession,
}));

// setupState (pulled in by the guard) would otherwise touch the real DB/_meta.
vi.mock("@/lib/db/helpers/metaStore.js", () => ({
  getMeta: mocks.getMeta,
  setMeta: vi.fn(),
}));

vi.mock("@/lib/auth/oidc", () => ({
  isOidcConfigured: () => false,
}));

const { proxy, __test__ } = await import("../../src/dashboardGuard.js");

const PEER_TOKEN = "peer-token-fixture";

function request(pathname, headers = {}, cookieValue = undefined) {
  const normalizedHeaders = new Headers(headers);
  return {
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers: normalizedHeaders,
    cookies: { get: vi.fn(() => (cookieValue ? { value: cookieValue } : undefined)) },
    url: `http://localhost${pathname}`,
  };
}

// A request that actually came through custom-server.js: peer IP stamped from the TCP
// socket and proven by the per-process secret.
function localRequest(pathname, headers = {}) {
  return request(pathname, { "x-9r-peer-token": PEER_TOKEN, "x-9r-real-ip": "127.0.0.1", ...headers });
}

describe("dashboard guard public LLM API access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NINEROUTER_PEER_TOKEN = PEER_TOKEN;
    mocks.getSettings.mockResolvedValue({ requireLogin: true, password: "$2a$10$storedhash" });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
    mocks.getDashboardAuthSession.mockResolvedValue(null);
    mocks.getMeta.mockResolvedValue("0");
  });

  it("allows loopback public LLM API without API key", async () => {
    const response = await proxy(localRequest("/v1/chat/completions", { host: "localhost:20128" }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("rejects remote Host-spoof when real peer IP is non-loopback", async () => {
    const response = await proxy(localRequest("/v1/chat/completions", {
      host: "localhost",
      "x-9r-real-ip": "10.204.111.34",
    }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("allows loopback peer IP regardless of Host", async () => {
    const response = await proxy(localRequest("/v1/chat/completions", {
      host: "localhost:20128",
      "x-9r-real-ip": "127.0.0.1",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("rejects remote rewritten public LLM API without API key", async () => {
    const response = await proxy(request("/api/v1/chat/completions", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("allows loopback rewritten public LLM API without API key", async () => {
    const response = await proxy(localRequest("/api/v1/chat/completions", { host: "localhost:20128" }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("rejects remote beta public LLM API without API key", async () => {
    const response = await proxy(request("/v1beta/models", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("rejects remote rewritten beta public LLM API without API key", async () => {
    const response = await proxy(request("/api/v1beta/models", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("rejects remote codex rewrite without API key", async () => {
    const response = await proxy(request("/codex/x", { host: "router.example.com" }));

    expect(response.status).toBe(401);
    expect(response.body.error).toBe("API key required for remote API access");
  });

  it("allows remote codex rewrite with valid API key", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/codex/x", {
      host: "router.example.com",
      authorization: "Bearer sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("allows remote public LLM API with valid bearer API key", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/api/v1/chat/completions", {
      host: "router.example.com",
      authorization: "Bearer sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("allows remote public LLM API with valid x-api-key", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/v1/web/fetch", {
      host: "router.example.com",
      "x-api-key": "sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("allows remote rewritten beta public LLM API with valid API key", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/api/v1beta/models", {
      host: "router.example.com",
      "x-api-key": "sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("allows remote beta public LLM API with valid Google API key header", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/v1beta/models", {
      host: "router.example.com",
      "x-goog-api-key": "sk-valid",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });

  it("allows remote beta public LLM API with valid Google key query parameter", async () => {
    mocks.validateApiKey.mockResolvedValue(true);

    const response = await proxy(request("/v1beta/models?key=sk-valid", {
      host: "router.example.com",
    }));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-valid");
  });
});

describe("dashboard guard local-only access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NINEROUTER_PEER_TOKEN = PEER_TOKEN;
    mocks.getSettings.mockResolvedValue({ requireLogin: true, password: "$2a$10$storedhash" });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
    mocks.getDashboardAuthSession.mockResolvedValue(null);
    mocks.getMeta.mockResolvedValue("0");
  });

  it("rejects local-only route from non-loopback host without CLI token", async () => {
    const response = await proxy(request("/api/mcp/filesystem/sse", {
      host: "router.example.com",
    }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Local only: CLI token required");
  });

  it("rejects local-only route on loopback when requireLogin=true and no JWT", async () => {
    const response = await proxy(localRequest("/api/mcp/filesystem/sse", {
      host: "localhost:20128",
      origin: "http://localhost:20128",
    }));

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("Local only: CLI token required");
  });

  it("allows local-only route on loopback when requireLogin=false", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false, password: "$2a$10$storedhash" });

    const response = await proxy(localRequest("/api/cli-tools/antigravity-mitm", {
      host: "localhost:20128",
      origin: "http://localhost:20128",
    }));

    expect(response).toBe(mocks.nextResponse);
  });

  it("rejects local-only route from tunnel host even when requireLogin=false", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false, password: "$2a$10$storedhash" });

    const response = await proxy(request("/api/cli-tools/antigravity-mitm", {
      host: "router.example.com",
    }));

    expect(response.status).toBe(403);
  });

  it("rejects local-only route when Origin is non-loopback (CSRF block)", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false, password: "$2a$10$storedhash" });

    const response = await proxy(localRequest("/api/cli-tools/antigravity-mitm", {
      host: "localhost:20128",
      origin: "http://evil.example.com",
    }));

    expect(response.status).toBe(403);
  });

  it("allows local-only route with valid CLI token", async () => {
    const response = await proxy(request("/api/mcp/filesystem/sse", {
      host: "router.example.com",
      "x-9r-cli-token": "cli-token",
    }));

    expect(response).toBe(mocks.nextResponse);
  });
});

describe("dashboard guard first-run setup gate", () => {
  // No stored password hash and no legacy stamp → instance is unclaimed.
  const unclaimed = { requireLogin: true };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue(unclaimed);
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
    mocks.getDashboardAuthSession.mockResolvedValue(null);
    mocks.getMeta.mockResolvedValue("0");
  });

  it("redirects the dashboard to /setup", async () => {
    const response = await proxy(request("/dashboard", { host: "localhost:20128" }));

    expect(response.status).toBe(307);
    expect(response.url.pathname).toBe("/setup");
  });

  it("redirects the login page to /setup", async () => {
    const response = await proxy(request("/login", { host: "localhost:20128" }));

    expect(response.status).toBe(307);
    expect(response.url.pathname).toBe("/setup");
  });

  it("serves /setup itself", async () => {
    const response = await proxy(request("/setup", { host: "localhost:20128" }));

    expect(response).toBe(mocks.nextResponse);
  });

  it("does not let requireLogin=false open an unclaimed instance", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });

    const page = await proxy(request("/dashboard", { host: "localhost:20128" }));
    expect(page.status).toBe(307);
    expect(page.url.pathname).toBe("/setup");

    const api = await proxy(request("/api/settings", { host: "localhost:20128" }));
    expect(api.status).toBe(401);
  });

  it("redirects /setup back to /login once a password is stored", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: true, password: "$2a$10$storedhash" });

    const response = await proxy(request("/setup", { host: "localhost:20128" }));

    expect(response.status).toBe(307);
    expect(response.url.pathname).toBe("/login");
  });

  it("keeps the legacy default-password install on the normal login page", async () => {
    mocks.getMeta.mockResolvedValue("1");

    const response = await proxy(request("/login", { host: "localhost:20128" }));

    expect(response).toBe(mocks.nextResponse);
  });
});

describe("dashboard guard forced password change", () => {
  const RESTRICTED = { authenticated: true, pwChange: true };

  beforeEach(() => {
    vi.clearAllMocks();
    // Legacy install: password hash absent, grace stamp present.
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.getMeta.mockResolvedValue("1");
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);
    mocks.getDashboardAuthSession.mockResolvedValue(RESTRICTED);
  });

  it("sends a restricted session back to /login instead of the dashboard", async () => {
    const response = await proxy(request("/dashboard", { host: "localhost:20128" }, "restricted-jwt"));

    expect(response.status).toBe(307);
    expect(response.url.pathname).toBe("/login");
  });

  it("refuses protected APIs for a restricted session", async () => {
    const response = await proxy(request("/api/settings", { host: "localhost:20128" }, "restricted-jwt"));

    expect(response.status).toBe(403);
    expect(response.body.mustChangePassword).toBe(true);
  });

  it("refuses always-protected routes for a restricted session", async () => {
    const response = await proxy(request("/api/shutdown", { host: "localhost:20128" }, "restricted-jwt"));

    expect(response.status).toBe(403);
  });

  it("allows the change-password endpoint", async () => {
    const response = await proxy(request("/api/auth/change-password", { host: "localhost:20128" }, "restricted-jwt"));

    expect(response).toBe(mocks.nextResponse);
  });

  it("allows logout so a restricted session is not a trap", async () => {
    const response = await proxy(request("/api/auth/logout", { host: "localhost:20128" }, "restricted-jwt"));

    expect(response).toBe(mocks.nextResponse);
  });

  it("lets a full session through once the change is done", async () => {
    mocks.getDashboardAuthSession.mockResolvedValue({ authenticated: true });
    mocks.getSettings.mockResolvedValue({ requireLogin: true, password: "$2a$10$storedhash" });
    mocks.getMeta.mockResolvedValue("0");

    const response = await proxy(request("/dashboard", { host: "localhost:20128" }, "full-jwt"));

    expect(response).toBe(mocks.nextResponse);
  });
});

describe("dashboard guard helpers", () => {
  it("extracts bearer API keys before x-api-key", () => {
    const apiRequest = request("/v1/chat/completions", {
      authorization: "Bearer bearer-key",
      "x-api-key": "header-key",
    });

    expect(__test__.extractApiKey(apiRequest)).toBe("bearer-key");
  });

  it("extracts Google API keys after x-api-key", () => {
    const apiRequest = request("/v1beta/models?key=query-key", {
      "x-api-key": "header-key",
      "x-goog-api-key": "google-key",
    });

    expect(__test__.extractApiKey(apiRequest)).toBe("header-key");
  });
});
