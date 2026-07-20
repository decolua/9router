import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getExecutor: vi.fn(),
  getProviderConnectionById: vi.fn(),
  getUsageForProvider: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: mocks.getProviderConnectionById,
  updateProviderConnection: mocks.updateProviderConnection,
}));
vi.mock("open-sse/services/usage.js", () => ({
  getUsageForProvider: mocks.getUsageForProvider,
}));
vi.mock("open-sse/executors/index.js", () => ({
  getExecutor: mocks.getExecutor,
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
}));

const connection = {
  id: "conn-1",
  provider: "codex",
  authType: "oauth",
  accessToken: "access-token",
  refreshToken: "refresh-token",
  providerSpecificData: { proxyPoolId: "pool-1" },
};

const proxyRoute = {
  source: "pool",
  proxyPoolId: "pool-1",
  proxyPool: { id: "pool-1" },
  proxyUnavailable: false,
  connectionProxyEnabled: true,
  connectionProxyUrl: "http://proxy.test:8080",
  connectionNoProxy: "",
  vercelRelayUrl: "",
  strictProxy: true,
  disableEnvProxy: true,
};

describe("usage route proxy lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getProviderConnectionById.mockResolvedValue(connection);
    mocks.resolveConnectionProxyConfig.mockResolvedValue(proxyRoute);
    mocks.getExecutor.mockReturnValue({ needsRefresh: vi.fn(() => false) });
    mocks.getUsageForProvider.mockResolvedValue({ quotas: {} });
  });

  it("passes the complete normalized route through refresh and usage", async () => {
    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");

    const response = await GET(new Request("http://localhost/api/usage/conn-1"), {
      params: Promise.resolve({ connectionId: "conn-1" }),
    });

    expect(response.status).toBe(200);
    expect(mocks.getUsageForProvider).toHaveBeenCalledWith(connection, proxyRoute);
  });

  it("rejects an unavailable pool before refresh or provider I/O", async () => {
    mocks.resolveConnectionProxyConfig.mockResolvedValue({
      source: "unavailable",
      proxyPoolId: "missing-pool",
      proxyUnavailable: true,
      strictProxy: true,
      disableEnvProxy: true,
    });
    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");

    const response = await GET(new Request("http://localhost/api/usage/conn-1"), {
      params: Promise.resolve({ connectionId: "conn-1" }),
    });

    expect(response.status).toBe(503);
    expect(mocks.getExecutor).not.toHaveBeenCalled();
    expect(mocks.getUsageForProvider).not.toHaveBeenCalled();
  });

  it("sanitizes nested refresh errors in logs and API responses", async () => {
    const secret = "https://user:password@provider.test/token?code=SECRET-CODE&refresh_token=SECRET-REFRESH";
    mocks.getExecutor.mockReturnValue({
      needsRefresh: vi.fn(() => true),
      refreshCredentials: vi.fn(async () => { throw new Error(secret); }),
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");

    const response = await GET(new Request("http://localhost/api/usage/conn-1"), {
      params: Promise.resolve({ connectionId: "conn-1" }),
    });
    const output = `${JSON.stringify(await response.json())} ${logged.mock.calls.flat().map(String).join(" ")}`;

    expect(response.status).toBe(401);
    for (const value of ["user", "password", "SECRET-CODE", "SECRET-REFRESH"]) {
      expect(output).not.toContain(value);
    }
  });

  it("sanitizes nested provider errors in logs and API responses", async () => {
    const secret = "https://user:password@provider.test/usage?access_token=SECRET-TOKEN";
    mocks.getUsageForProvider.mockRejectedValue(new Error(secret));
    const logged = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");

    const response = await GET(new Request("http://localhost/api/usage/conn-1"), {
      params: Promise.resolve({ connectionId: "conn-1" }),
    });
    const output = `${JSON.stringify(await response.json())} ${logged.mock.calls.flat().map(String).join(" ")}`;

    expect(response.status).toBe(500);
    for (const value of ["user", "password", "SECRET-TOKEN"]) expect(output).not.toContain(value);
  });
});
