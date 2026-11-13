import { beforeEach, describe, expect, it, vi } from "vitest";

// MiniMax desktop-lease connections store no token: the usage handler borrows one
// from the broker. The route must let them through instead of answering
// "Usage not available".
const mocks = vi.hoisted(() => ({ getConnection: vi.fn(), getUsage: vi.fn() }));
vi.mock("open-sse/index.js", () => ({}));
vi.mock("../../src/lib/localDb.js", () => ({ getProviderConnectionById: mocks.getConnection, updateProviderConnection: vi.fn() }));
vi.mock("open-sse/services/usage.js", () => ({ getUsageForProvider: mocks.getUsage }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: async () => ({}) }));
vi.mock("@/lib/auth/dashboardPrivacy", () => ({ sanitizeDashboardResponse: async (value) => value }));

const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");
const call = () => GET(new Request("http://localhost/api/usage/c1"), { params: Promise.resolve({ connectionId: "c1" }) });

beforeEach(() => vi.resetAllMocks());

describe("usage route for MiniMax lease connections", () => {
  it("fetches usage for an mcode-lease connection", async () => {
    mocks.getConnection.mockResolvedValue({ id: "c1", provider: "minimax-code", authType: "mcode-lease", providerSpecificData: {} });
    mocks.getUsage.mockResolvedValue({ quotas: { Credits: { used: 0, total: 5 } } });

    const body = await (await call()).json();

    expect(mocks.getUsage).toHaveBeenCalledOnce();
    expect(body).toEqual({ quotas: { Credits: { used: 0, total: 5 } } });
  });

  it("still refuses connections with no usage path", async () => {
    mocks.getConnection.mockResolvedValue({ id: "c1", provider: "minimax-code", authType: "cookie" });

    const body = await (await call()).json();

    expect(mocks.getUsage).not.toHaveBeenCalled();
    expect(body.message).toBe("Usage not available for this connection");
  });
});
