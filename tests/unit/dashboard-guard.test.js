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

const { proxy, __test__ } = await import("../../src/dashboardGuard.js");

const PEER_TOKEN = "peer-token-fixture";

function request(pathname, headers = {}, method = "GET") {
  const normalizedHeaders = new Headers(headers);
  return {
    method,
    nextUrl: { pathname, searchParams: new URL(`http://localhost${pathname}`).searchParams },
    headers: normalizedHeaders,
    cookies: { get: vi.fn(() => undefined) },
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
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
    __test__._resetCachedCliToken();
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

  it.each([
    "/v1/messages",
    "/api/v1/chat/completions",
    "/v1beta/models",
  ])("allows remote OPTIONS %s without settings or API key validation", async (pathname) => {
    const response = await proxy(request(pathname, { host: "router.example.com" }, "OPTIONS"));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.getSettings).not.toHaveBeenCalled();
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("allows remote keyless POST when requireApiKey=false without validating a key", async () => {
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });

    const response = await proxy(request("/v1/messages", { host: "router.example.com" }, "POST"));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("allows remote keyless GET when requireApiKey=false", async () => {
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });

    const response = await proxy(request("/v1/models", { host: "router.example.com" }));

    expect(response).toBe(mocks.nextResponse);
  });

  it("rejects remote actual POST without a key when requireApiKey=true", async () => {
    const response = await proxy(request("/v1/messages", { host: "router.example.com" }, "POST"));

    expect(response.status).toBe(401);
  });

  it.each([
    ["x-api-key", "sk-invalid"],
    ["authorization", "Bearer sk-invalid"],
    ["x-goog-api-key", "sk-invalid"],
  ])("rejects invalid %s even when requireApiKey=false", async (header, value) => {
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });

    const response = await proxy(request("/v1/messages", {
      host: "router.example.com",
      [header]: value,
    }, "POST"));

    expect(response.status).toBe(401);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-invalid");
  });

  it("rejects an invalid Gemini query key even when requireApiKey=false", async () => {
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });

    const response = await proxy(request("/v1beta/models?key=sk-invalid", {
      host: "router.example.com",
    }, "POST"));

    expect(response.status).toBe(401);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-invalid");
  });

  it("fails closed when settings read rejects for a keyless actual request", async () => {
    mocks.getSettings.mockRejectedValue(new Error("settings unavailable"));

    const response = await proxy(request("/v1/messages", { host: "router.example.com" }, "POST"));

    expect(response.status).toBe(401);
  });

  it("allows OPTIONS when settings read rejects", async () => {
    mocks.getSettings.mockRejectedValue(new Error("settings unavailable"));

    const response = await proxy(request("/v1/messages", { host: "router.example.com" }, "OPTIONS"));

    expect(response).toBe(mocks.nextResponse);
    expect(mocks.getSettings).not.toHaveBeenCalled();
  });

  it("allows loopback OPTIONS", async () => {
    const response = await proxy(request("/v1/messages", { host: "localhost:20128" }, "OPTIONS"));

    expect(response).toBe(mocks.nextResponse);
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

  describe("dashboard guard proxy fitness access", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      process.env.NINEROUTER_PEER_TOKEN = PEER_TOKEN;
      mocks.getSettings.mockResolvedValue({ requireLogin: true });
      mocks.verifyDashboardAuthToken.mockResolvedValue(false);
      mocks.getConsistentMachineId.mockResolvedValue("mocked-cli-token");
      __test__._resetCachedCliToken();
    });

    const fitnessPaths = [
      "/api/proxy-pools/fitness",
      "/api/proxy-pools/pool123/fitness/clear",
      "/api/proxy-pools/fitness/clear-all"
    ];

    it("allows access with valid dashboard JWT", async () => {
      mocks.verifyDashboardAuthToken.mockResolvedValue(true);
      for (const path of fitnessPaths) {
        const req = request(path);
        req.cookies.get.mockReturnValue({ value: "valid-jwt-token" });
        const res = await proxy(req);

        expect(mocks.verifyDashboardAuthToken).toHaveBeenCalledWith("valid-jwt-token");
        expect(res, `Failed for ${path}`).toBe(mocks.nextResponse);
      }
    });

    it("allows access with valid CLI token", async () => {
      for (const path of fitnessPaths) {
        mocks.getConsistentMachineId.mockResolvedValue("mocked-cli-token");
        const req = request(path, { "x-9r-cli-token": "mocked-cli-token" });
        const res = await proxy(req);
        expect(res, `Failed for ${path}`).toBe(mocks.nextResponse);
      }
    });

    it("allows access when requireLogin=false", async () => {
      mocks.verifyDashboardAuthToken.mockResolvedValue(false);
      mocks.getSettings.mockResolvedValue({ requireLogin: false });
      for (const path of fitnessPaths) {
        const req = request(path);
        const res = await proxy(req);
        expect(res, `Failed for ${path}`).toBe(mocks.nextResponse);
      }
    });

    it("rejects access when requireLogin=true and no JWT", async () => {
      mocks.verifyDashboardAuthToken.mockResolvedValue(false);
      mocks.getSettings.mockResolvedValue({ requireLogin: true });
      for (const path of fitnessPaths) {
        const req = request(path);
        const res = await proxy(req);
        expect(res.status, `Failed for ${path}`).toBe(401);
      }
    });

    it("fails closed (rejects access) when settings read rejects", async () => {
      mocks.verifyDashboardAuthToken.mockResolvedValue(false);
      mocks.getSettings.mockRejectedValue(new Error("DB locked"));
      for (const path of fitnessPaths) {
        const req = request(path);
        const res = await proxy(req);
        expect(res.status, `Failed for ${path}`).toBe(401);
      }
    });
  });

  describe("dashboard guard local-only access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NINEROUTER_PEER_TOKEN = PEER_TOKEN;
    mocks.getSettings.mockResolvedValue({ requireLogin: true });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
    __test__._resetCachedCliToken();
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
    mocks.getSettings.mockResolvedValue({ requireLogin: false });

    const response = await proxy(localRequest("/api/cli-tools/antigravity-mitm", {
      host: "localhost:20128",
      origin: "http://localhost:20128",
    }));

    expect(response).toBe(mocks.nextResponse);
  });

  it("rejects local-only route from tunnel host even when requireLogin=false", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });

    const response = await proxy(request("/api/cli-tools/antigravity-mitm", {
      host: "router.example.com",
    }));

    expect(response.status).toBe(403);
  });

  it("rejects local-only route when Origin is non-loopback (CSRF block)", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false });

    const response = await proxy(localRequest("/api/cli-tools/antigravity-mitm", {
      host: "localhost:20128",
      origin: "http://evil.example.com",
    }));

    expect(response.status).toBe(403);
  });

  it("allows local-only route with valid CLI token", async () => {
    __test__._resetCachedCliToken();
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");

    const response = await proxy(request("/api/mcp/filesystem/sse", {
      host: "router.example.com",
      "x-9r-cli-token": "cli-token",
    }));

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
