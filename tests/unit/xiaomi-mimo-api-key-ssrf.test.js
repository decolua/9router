import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isLocalRequest: vi.fn(),
  fetchPublic: vi.fn(),
  createProviderConnection: vi.fn(),
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/dashboardGuard", () => ({ isLocalRequest: mocks.isLocalRequest }));
vi.mock("@/shared/utils/ssrfGuard.js", () => ({ fetchPublic: mocks.fetchPublic }));
vi.mock("@/models", () => ({
  createProviderConnection: mocks.createProviderConnection,
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
}));

const { POST } = await import("@/app/api/oauth/xiaomi-mimo/api-key/route.js");
const request = (body) => ({ json: async () => body });

describe("Xiaomi MiMo API-key import SSRF guard", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createProviderConnection.mockResolvedValue({ id: 1, provider: "xiaomi-mimo" });
    mocks.getProviderConnections.mockResolvedValue([]);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("uses the DNS/redirect-validated fetch path for a remote caller", async () => {
    mocks.isLocalRequest.mockReturnValue(false);
    mocks.fetchPublic.mockRejectedValue(new Error("Blocked URL: internal host"));
    const directFetch = vi.fn();
    global.fetch = directFetch;

    await POST(request({
      apiKey: "sk-test",
      baseUrl: "http://127.0.0.1:9999",
    }));

    expect(mocks.fetchPublic).toHaveBeenCalledTimes(1);
    expect(String(mocks.fetchPublic.mock.calls[0][0])).toBe("http://127.0.0.1:9999/models");
    expect(directFetch).not.toHaveBeenCalled();
  });

  it("preserves private self-hosted endpoints for a verified local caller", async () => {
    mocks.isLocalRequest.mockReturnValue(true);
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: "local-model" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const response = await POST(request({
      apiKey: "sk-test",
      baseUrl: "http://127.0.0.1:9999/v1",
    }));

    expect(mocks.fetchPublic).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });
});
