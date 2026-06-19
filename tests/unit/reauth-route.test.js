import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn() }));
vi.mock("@/lib/providers/refreshCredentials.js", () => ({ refreshAndUpdateCredentials: vi.fn() }));

const { getProviderConnectionById } = await import("@/lib/localDb");
const { resolveConnectionProxyConfig } = await import("@/lib/network/connectionProxy");
const { refreshAndUpdateCredentials } = await import("@/lib/providers/refreshCredentials.js");
const { POST } = await import("../../src/app/api/providers/[id]/reauth/route.js");

function mockParams(id) { return { params: Promise.resolve({ id }) }; }

describe("POST /api/providers/[id]/reauth", () => {
  it("returns 400 when id missing", async () => {
    const res = await POST({}, mockParams(undefined));
    expect(res.status).toBe(400);
  });

  it("returns 404 when connection not found", async () => {
    getProviderConnectionById.mockResolvedValue(null);
    const res = await POST({}, mockParams("nonexistent"));
    expect(res.status).toBe(404);
  });

  it("returns ok with refreshed credentials on success", async () => {
    const conn = { id: "c1", provider: "claude", authType: "oauth" };
    getProviderConnectionById.mockResolvedValue(conn);
    resolveConnectionProxyConfig.mockResolvedValue({ connectionProxyEnabled: false });
    refreshAndUpdateCredentials.mockResolvedValue({ connection: { ...conn, accessToken: "new" }, refreshed: true });

    const res = await POST({}, mockParams("c1"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.refreshed).toBe(true);
  });

  it("returns 401 when refresh token dead", async () => {
    const conn = { id: "c1", provider: "claude", authType: "oauth" };
    getProviderConnectionById.mockResolvedValue(conn);
    resolveConnectionProxyConfig.mockResolvedValue({});
    refreshAndUpdateCredentials.mockRejectedValue(new Error("Please re-authorize the connection."));

    const res = await POST({}, mockParams("c1"));
    expect(res.status).toBe(401);
  });
});
