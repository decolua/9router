import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  backfillCodexEmails: vi.fn(),
  jsonResponse: vi.fn((body, init) => {
    const serialized = JSON.stringify(body);
    return {
      status: init?.status || 200,
      body: JSON.parse(serialized),
    };
  }),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: mocks.jsonResponse,
  },
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
}));

vi.mock("@/lib/oauth/providers", () => ({
  backfillCodexEmails: mocks.backfillCodexEmails,
}));

const { GET } = await import("../../src/app/api/providers/client/route.js");

function request(path) {
  return { url: `http://localhost:20128${path}` };
}

describe("providers client route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.backfillCodexEmails.mockResolvedValue(undefined);
  });

  it("sorts priority results with BigInt priorities without returning 500", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      {
        id: "second",
        provider: "codex",
        authType: "oauth",
        name: "Second",
        priority: 2n,
        isActive: true,
      },
      {
        id: "first",
        provider: "claude",
        authType: "oauth",
        name: "First",
        priority: 1n,
        isActive: true,
      },
    ]);

    const response = await GET(request("/api/providers/client?page=1&pageSize=20&accountStatus=all&sort=priority"));

    expect(response.status).toBe(200);
    expect(response.body.connections.map((conn) => conn.id)).toEqual(["first", "second"]);
    expect(response.body.connections.map((conn) => conn.priority)).toEqual([1, 2]);
  });

  it("places invalid priority values after valid numeric priorities", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      {
        id: "invalid",
        provider: "codex",
        authType: "oauth",
        name: "Invalid",
        priority: "not-a-number",
        isActive: true,
      },
      {
        id: "valid",
        provider: "claude",
        authType: "oauth",
        name: "Valid",
        priority: "1",
        isActive: true,
      },
    ]);

    const response = await GET(request("/api/providers/client?sort=priority"));

    expect(response.status).toBe(200);
    expect(response.body.connections.map((conn) => conn.id)).toEqual(["valid", "invalid"]);
  });

  it("sorts expiring results by connection expiry before paginating", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      {
        id: "third",
        provider: "codex",
        authType: "oauth",
        name: "Third",
        priority: 1,
        expiresAt: "2026-05-25T10:00:00.000Z",
        isActive: true,
      },
      {
        id: "first",
        provider: "claude",
        authType: "oauth",
        name: "First",
        priority: 3,
        rateLimitedUntil: "2026-05-24T10:00:00.000Z",
        isActive: true,
      },
      {
        id: "second",
        provider: "github",
        authType: "oauth",
        name: "Second",
        priority: 2,
        expiresAt: "2026-05-24T12:00:00.000Z",
        isActive: true,
      },
      {
        id: "undated",
        provider: "codex",
        authType: "oauth",
        name: "Undated",
        priority: 0,
        isActive: true,
      },
    ]);

    const response = await GET(request("/api/providers/client?sort=expiring&page=1&pageSize=2"));

    expect(response.status).toBe(200);
    expect(response.body.connections.map((conn) => conn.id)).toEqual(["first", "second"]);
    expect(response.body.pagination).toMatchObject({
      page: 1,
      pageSize: 2,
      total: 4,
      totalPages: 2,
    });
  });

  it("falls back to priority when expiring results have no expiry time", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      {
        id: "second",
        provider: "codex",
        authType: "oauth",
        name: "Second",
        priority: 2,
        isActive: true,
      },
      {
        id: "first",
        provider: "claude",
        authType: "oauth",
        name: "First",
        priority: 1,
        isActive: true,
      },
    ]);

    const response = await GET(request("/api/providers/client?sort=expiring"));

    expect(response.status).toBe(200);
    expect(response.body.connections.map((conn) => conn.id)).toEqual(["first", "second"]);
  });

  it("includes error details when provider client fetch fails", async () => {
    mocks.getProviderConnections.mockRejectedValue(new Error("database unavailable"));

    const response = await GET(request("/api/providers/client"));

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: "Failed to fetch providers",
      details: "database unavailable",
    });
  });
});
