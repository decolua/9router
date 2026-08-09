import { beforeEach, describe, expect, it, vi } from "vitest";

const getProviderConnections = vi.fn();

vi.mock("@/lib/localDb", () => ({ getProviderConnections }));
vi.mock("@/lib/oauth/providers", () => ({ backfillCodexEmails: vi.fn() }));

const { GET } = await import("@/app/api/providers/client/route.js");

function connection(id, lockUntil) {
  return {
    id,
    provider: "kiro",
    authType: "api_key",
    name: `Kiro API ${id}`,
    isActive: true,
    testStatus: "unavailable",
    ...(lockUntil && { "modelLock_claude-opus-5": lockUntil }),
  };
}

describe("provider client status", () => {
  beforeEach(() => getProviderConnections.mockReset());

  it("reports effective status without exposing model locks", async () => {
    getProviderConnections.mockResolvedValue([
      connection("expired", "2000-01-01T00:00:00Z"),
      connection("active", "2999-01-01T00:00:00Z"),
    ]);

    const response = await GET(new Request("http://localhost/api/providers/client?provider=kiro"));
    const { connections } = await response.json();
    const byId = Object.fromEntries(connections.map((item) => [item.id, item]));

    expect(byId.expired.testStatus).toBe("active");
    expect(byId.active.testStatus).toBe("unavailable");
    expect(byId.expired).not.toHaveProperty("modelLock_claude-opus-5");
  });
});
