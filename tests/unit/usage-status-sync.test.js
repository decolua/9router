import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConnections = [];
const updateProviderConnection = vi.fn(async (id, data) => ({ id, ...data }));
const getProviderConnectionById = vi.fn(async (id) => mockConnections.find((conn) => conn.id === id) || null);
const getUsageForProvider = vi.fn(async () => ({ ok: true }));

vi.mock("next/server", () => ({
  NextResponse: {
    json: (body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    }),
  },
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById,
  updateProviderConnection,
}));

vi.mock("open-sse/services/usage.js", () => ({
  getUsageForProvider,
}));

vi.mock("open-sse/index.js", () => ({}));

vi.mock("open-sse/executors/index.js", () => ({
  getExecutor: () => ({
    needsRefresh: () => false,
    refreshCredentials: async () => null,
  }),
}));

describe("usage request status sync", () => {
  beforeEach(() => {
    mockConnections.length = 0;
    updateProviderConnection.mockClear();
    getProviderConnectionById.mockClear();
    getUsageForProvider.mockClear();
    vi.resetModules();
  });

  it("marks the connection active after successful usage fetch", async () => {
    mockConnections.push({
      id: "conn-1",
      provider: "codex",
      authType: "oauth",
      accessToken: "token",
      refreshToken: "refresh",
      testStatus: "unknown",
    });

    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");
    const response = await GET(new Request("http://localhost/api/usage/conn-1"), {
      params: Promise.resolve({ connectionId: "conn-1" }),
    });

    expect(response.status).toBe(200);
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-1", expect.objectContaining({
      testStatus: "active",
      lastError: null,
      lastErrorType: null,
      lastErrorAt: null,
    }));
  });

  it("marks weekly-only Codex connections unavailable when weekly quota is exhausted", async () => {
    mockConnections.push({
      id: "conn-weekly-exhausted",
      provider: "codex",
      authType: "oauth",
      accessToken: "token",
      refreshToken: "refresh",
      testStatus: "unknown",
    });

    getUsageForProvider.mockResolvedValueOnce({
      plan: "free",
      quotas: {
        weekly: {
          used: 100,
          total: 100,
          remaining: 0,
          resetAt: "2026-04-25T00:00:00.000Z",
        },
      },
    });

    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");
    const response = await GET(new Request("http://localhost/api/usage/conn-weekly-exhausted"), {
      params: Promise.resolve({ connectionId: "conn-weekly-exhausted" }),
    });

    expect(response.status).toBe(200);
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-weekly-exhausted",
      expect.objectContaining({ testStatus: "unavailable" })
    );
  });

  it("keeps weekly-only Codex connections active when weekly quota remains", async () => {
    mockConnections.push({
      id: "conn-weekly-active",
      provider: "codex",
      authType: "oauth",
      accessToken: "token",
      refreshToken: "refresh",
      testStatus: "unknown",
    });

    getUsageForProvider.mockResolvedValueOnce({
      plan: "free",
      quotas: {
        weekly: {
          used: 55,
          total: 100,
          remaining: 45,
          resetAt: "2026-04-25T00:00:00.000Z",
        },
      },
    });

    const { GET } = await import("../../src/app/api/usage/[connectionId]/route.js");
    const response = await GET(new Request("http://localhost/api/usage/conn-weekly-active"), {
      params: Promise.resolve({ connectionId: "conn-weekly-active" }),
    });

    expect(response.status).toBe(200);
    expect(updateProviderConnection).toHaveBeenCalledWith(
      "conn-weekly-active",
      expect.objectContaining({ testStatus: "active" })
    );
  });
});
