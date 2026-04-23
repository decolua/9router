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

const LEGACY_FIELDS = [
  "testStatus",
  "lastTested",
  "lastError",
  "lastErrorType",
  "lastErrorAt",
  "rateLimitedUntil",
  "errorCode",
];

describe("credentials import/export canonical transport", () => {
  beforeEach(() => {
    mockConnections.length = 0;
    createProviderConnection.mockClear();
    updateProviderConnection.mockClear();
    getProviderConnections.mockClear();
    getProviderConnections.mockResolvedValue(mockConnections);
  });

  it("exports canonical-only status fields and excludes legacy mirrors", async () => {
    mockConnections.push({
      id: "conn-1",
      provider: "codex",
      authType: "oauth",
      name: "Account 1",
      accessToken: "access-token",
      authState: "expired",
      healthStatus: "healthy",
      quotaState: "cooldown",
      routingStatus: "exhausted",
      nextRetryAt: "2026-04-20T10:00:00.000Z",
      resetAt: "2026-04-20T11:00:00.000Z",
      testStatus: "error",
      lastErrorType: "token_expired",
      lastError: "Token expired",
    });

    const { GET: exportGET } = await import("../../src/app/api/credentials/export/route.js");
    const exportResponse = await exportGET();

    expect(exportResponse.status).toBe(200);
    expect(exportResponse.body.entries).toHaveLength(1);
    const [entry] = exportResponse.body.entries;

    expect(entry).toMatchObject({
      authState: "expired",
      healthStatus: "healthy",
      quotaState: "cooldown",
      routingStatus: "exhausted",
      nextRetryAt: "2026-04-20T10:00:00.000Z",
      resetAt: "2026-04-20T11:00:00.000Z",
    });

    for (const field of LEGACY_FIELDS) {
      expect(entry).not.toHaveProperty(field);
    }
  });

  it("imports legacy payloads by translating to canonical-only state", async () => {
    getProviderConnections.mockResolvedValue([]);

    const { POST: importPOST } = await import("../../src/app/api/credentials/import/route.js");
    const payload = {
      format: "universal-credentials",
      entries: [
        {
          provider: "codex",
          authType: "oauth",
          accessToken: "legacy-access",
          testStatus: "unavailable",
          lastErrorType: "token_expired",
          rateLimitedUntil: "2099-04-20T11:00:00.000Z",
        },
      ],
    };

    const importResponse = await importPOST(new Request("http://localhost/api/credentials/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }));

    expect(importResponse.status).toBe(200);
    expect(createProviderConnection).toHaveBeenCalledTimes(1);

    const [created] = createProviderConnection.mock.calls[0];
    expect(created).toMatchObject({
      provider: "codex",
      authType: "oauth",
      accessToken: "legacy-access",
      authState: "invalid",
      routingStatus: "blocked",
    });
    expect(created.quotaState === undefined || created.quotaState === "ok").toBe(true);
    expect(created.nextRetryAt === undefined || created.nextRetryAt === null).toBe(true);

    for (const field of LEGACY_FIELDS) {
      expect(created).not.toHaveProperty(field);
    }
  });
});
