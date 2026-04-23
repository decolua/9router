import { beforeEach, describe, expect, it, vi } from "vitest";

const mockConnections = [];
const getProviderConnections = vi.fn(async (filter = {}) => {
  if (filter?.provider) {
    return mockConnections.filter((connection) => connection.provider === filter.provider);
  }
  return mockConnections;
});
const updateProviderConnection = vi.fn(async (id, data) => ({ id, ...data }));

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
  getProviderConnections,
  updateProviderConnection,
}));

vi.mock("@/lib/connectionStatus", async () => {
  const actual = await import("../../src/lib/connectionStatus.js");
  return actual;
});

describe("models availability canonical cooldown read path", () => {
  beforeEach(() => {
    mockConnections.length = 0;
    getProviderConnections.mockClear();
    updateProviderConnection.mockClear();
    vi.resetModules();
  });

  it("uses canonical resetAt/nextRetryAt and ignores legacy rateLimitedUntil for exhausted rows", async () => {
    mockConnections.push({
      id: "conn-canonical-cooldown",
      provider: "codex",
      name: "Canonical Cooldown Conn",
      quotaState: "exhausted",
      rateLimitedUntil: "2027-04-30T00:00:00.000Z",
      nextRetryAt: "2027-04-24T00:00:00.000Z",
      resetAt: "2027-04-23T18:00:00.000Z",
    });

    const { GET } = await import("../../src/app/api/models/availability/route.js");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.models).toEqual([
      expect.objectContaining({
        connectionId: "conn-canonical-cooldown",
        provider: "codex",
        model: "__all",
        status: "exhausted",
        until: "2027-04-23T18:00:00.000Z",
      }),
    ]);
  });

  it("omits until when exhausted is driven only by legacy rateLimitedUntil", async () => {
    mockConnections.push({
      id: "conn-legacy-cooldown-only",
      provider: "codex",
      name: "Legacy Cooldown Only",
      quotaState: "exhausted",
      rateLimitedUntil: "2027-04-30T00:00:00.000Z",
    });

    const { GET } = await import("../../src/app/api/models/availability/route.js");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.models).toEqual([
      expect.objectContaining({
        connectionId: "conn-legacy-cooldown-only",
        provider: "codex",
        model: "__all",
        status: "exhausted",
      }),
    ]);
    expect(response.body.models[0].until).toBeUndefined();
  });

  it("does not emit provider-wide unavailable row for legacy testStatus-only unavailability", async () => {
    mockConnections.push({
      id: "conn-legacy-teststatus-unavailable",
      provider: "openrouter",
      name: "Legacy TestStatus Unavailable",
      testStatus: "unavailable",
    });

    const { GET } = await import("../../src/app/api/models/availability/route.js");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.body.models).toEqual([]);
  });
});
