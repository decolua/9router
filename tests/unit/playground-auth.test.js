import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  nextResponse: Symbol("next"),
  getSettings: vi.fn(),
  validateApiKey: vi.fn(),
  getConsistentMachineId: vi.fn(),
  verifyDashboardAuthToken: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    next: vi.fn(() => mocks.nextResponse),
    json: vi.fn((body, init) => ({ status: init?.status || 200, body })),
    redirect: vi.fn((url) => ({ status: 307, url })),
  },
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  validateApiKey: mocks.validateApiKey,
}));
vi.mock("@/shared/utils/machineId", () => ({ getConsistentMachineId: mocks.getConsistentMachineId }));
vi.mock("@/lib/auth/dashboardSession", () => ({ verifyDashboardAuthToken: mocks.verifyDashboardAuthToken }));
vi.mock("open-sse/index.js", () => ({}));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(() => null),
  isValidApiKey: vi.fn(),
  getApiKeyPolicyError: vi.fn(),
}));

const { proxy, __test__ } = await import("../../src/dashboardGuard.js");
const { handleChat, DASHBOARD_AUTHORIZED_CONTEXT } = await import("../../src/sse/handlers/chat.js");

function request(pathname, method = "POST") {
  return {
    method,
    nextUrl: { pathname, searchParams: new URL(`http://router.test${pathname}`).searchParams },
    headers: new Headers({ host: "router.test" }),
    cookies: { get: vi.fn(() => undefined) },
    url: `http://router.test${pathname}`,
  };
}

describe("dashboard playground adapter authorization contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireLogin: true, requireApiKey: true });
    mocks.validateApiKey.mockResolvedValue(false);
    mocks.getConsistentMachineId.mockResolvedValue("cli-token");
    mocks.verifyDashboardAuthToken.mockResolvedValue(false);
    __test__._resetCachedCliToken();
  });

  it("allows a dashboard-authenticated adapter request while API keys remain required globally", async () => {
    mocks.verifyDashboardAuthToken.mockResolvedValue(true);

    await expect(proxy(request("/api/dashboard/chat/completions"))).resolves.toBe(mocks.nextResponse);
    expect(mocks.validateApiKey).not.toHaveBeenCalled();
  });

  it("allows the adapter without a dashboard JWT only when requireLogin=false", async () => {
    mocks.getSettings.mockResolvedValue({ requireLogin: false, requireApiKey: true });

    await expect(proxy(request("/api/dashboard/chat/completions"))).resolves.toBe(mocks.nextResponse);
  });

  it("rejects an unauthenticated adapter request when dashboard login is required", async () => {
    const response = await proxy(request("/api/dashboard/chat/completions"));

    expect(response).toMatchObject({ status: 401, body: { error: "Unauthorized" } });
  });

  it("keeps the adapter out of public LLM API prefixes and denies arbitrary API routes by default", async () => {
    expect(__test__.isPublicLlmApi("/api/dashboard/chat/completions")).toBe(false);

    const response = await proxy(request("/api/not-a-public-route"));
    expect(response).toMatchObject({ status: 401, body: { error: "Unauthorized" } });
  });

  // Todo 6 owns route-level POST-only, 405, CORS, and handleChat delegation coverage.
  it("keeps ordinary public chat requests behind requireApiKey by default", async () => {
    const response = await handleChat(new Request("http://router.test/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "test-provider/test-model", messages: [] }),
      headers: { "content-type": "application/json" },
    }));

    expect(response.status).toBe(401);
  });

  it("lets only the module-owned context bypass API-key enforcement and policy", async () => {
    const response = await handleChat(
      new Request("http://router.test/api/dashboard/chat/completions", {
        method: "POST",
        body: JSON.stringify({ messages: [] }),
        headers: { "content-type": "application/json" },
      }),
      null,
      DASHBOARD_AUTHORIZED_CONTEXT,
    );

    expect(response.status).toBe(400);
  });

  it.each([
    ["body", "http://router.test/v1/chat/completions", { dashboardAuthorized: true }, {}],
    ["header", "http://router.test/v1/chat/completions", {}, { "x-dashboard-authorized": "true" }],
    ["query", "http://router.test/v1/chat/completions?dashboardAuthorized=true", {}, {}],
  ])("rejects forged %s authorization data", async (_source, url, body, headers) => {
    const response = await handleChat(new Request(url, {
      method: "POST",
      body: JSON.stringify({ model: "test-provider/test-model", messages: [], ...body }),
      headers: { "content-type": "application/json", ...headers },
    }));

    expect(response.status).toBe(401);
  });
});
