import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConnections = [];
const createProviderConnection = vi.fn(async (data) => ({
  id: data.id || `created-${mockConnections.length + 1}`,
  ...data,
}));
const updateProviderConnection = vi.fn(async (id, data) => ({ id, ...data }));
const getProviderConnections = vi.fn(async () => mockConnections);

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
  createProviderConnection,
  getProviderConnections,
  updateProviderConnection,
}));

describe("credentials backup round-trip", () => {
  beforeEach(() => {
    mockConnections.length = 0;
    createProviderConnection.mockClear();
    updateProviderConnection.mockClear();
    getProviderConnections.mockClear();
    getProviderConnections.mockResolvedValue(mockConnections);
  });

  it("exports and imports status metadata without losing fields", async () => {
    mockConnections.push({
      id: "conn-1",
      provider: "codex",
      authType: "oauth",
      name: "Account 1",
      isActive: true,
      accessToken: "access-token",
      refreshToken: "refresh-token",
      testStatus: "error",
      lastTested: "2026-04-20T10:00:00.000Z",
      lastError: "Token expired",
      lastErrorType: "token_expired",
      lastErrorAt: "2026-04-20T10:01:00.000Z",
      rateLimitedUntil: "2026-04-20T11:00:00.000Z",
      errorCode: "AUTH",
      providerSpecificData: { sessionId: "seed-1" },
    });

    const { GET: exportGET } = await import("../../src/app/api/credentials/export/route.js");
    const exportResponse = await exportGET();

    expect(exportResponse.status).toBe(200);
    expect(exportResponse.body.entries).toHaveLength(1);
    expect(exportResponse.body.entries[0]).toMatchObject({
      testStatus: "error",
      lastTested: "2026-04-20T10:00:00.000Z",
      lastError: "Token expired",
      lastErrorType: "token_expired",
      lastErrorAt: "2026-04-20T10:01:00.000Z",
      rateLimitedUntil: "2026-04-20T11:00:00.000Z",
      errorCode: "AUTH",
    });

    mockConnections.length = 0;
    getProviderConnections.mockResolvedValue([]);

    const { POST: importPOST } = await import("../../src/app/api/credentials/import/route.js");
    const importResponse = await importPOST(new Request("http://localhost/api/credentials/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(exportResponse.body),
    }));

    expect(importResponse.status).toBe(200);
    expect(createProviderConnection).toHaveBeenCalledTimes(1);
    expect(createProviderConnection).toHaveBeenCalledWith(expect.objectContaining({
      testStatus: "error",
      lastTested: "2026-04-20T10:00:00.000Z",
      lastError: "Token expired",
      lastErrorType: "token_expired",
      lastErrorAt: "2026-04-20T10:01:00.000Z",
      rateLimitedUntil: "2026-04-20T11:00:00.000Z",
      errorCode: "AUTH",
    }));
  });

  it("updates the only matching oauth connection when identity is missing", async () => {
    mockConnections.push({
      id: "conn-1",
      provider: "codex",
      authType: "oauth",
      name: "Account 1",
      accessToken: "old-access",
      testStatus: "active",
    });

    const { POST: importPOST } = await import("../../src/app/api/credentials/import/route.js");
    const payload = {
      format: "universal-credentials",
      entries: [
        {
          provider: "codex",
          authType: "oauth",
          accessToken: "new-access",
          testStatus: "error",
        },
      ],
    };

    const importResponse = await importPOST(new Request("http://localhost/api/credentials/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }));

    expect(importResponse.status).toBe(200);
    expect(updateProviderConnection).toHaveBeenCalledTimes(1);
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-1", expect.objectContaining({
      provider: "codex",
      authType: "oauth",
      accessToken: "new-access",
      testStatus: "error",
    }));
    expect(createProviderConnection).not.toHaveBeenCalled();
  });

  it("defaults restored codex oauth connections to active when status is missing", async () => {
    mockConnections.push({
      id: "conn-1",
      provider: "codex",
      authType: "oauth",
      name: "Account 1",
      accessToken: "old-access",
    });

    const { POST: importPOST } = await import("../../src/app/api/credentials/import/route.js");
    const payload = {
      format: "universal-credentials",
      entries: [
        {
          provider: "codex",
          authType: "oauth",
          accessToken: "new-access",
        },
      ],
    };

    const importResponse = await importPOST(new Request("http://localhost/api/credentials/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }));

    expect(importResponse.status).toBe(200);
    expect(updateProviderConnection).toHaveBeenCalledTimes(1);
    expect(updateProviderConnection).toHaveBeenCalledWith("conn-1", expect.objectContaining({
      provider: "codex",
      authType: "oauth",
      accessToken: "new-access",
      testStatus: "active",
    }));
    expect(createProviderConnection).not.toHaveBeenCalled();
  });
});
