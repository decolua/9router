import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
}));

describe("GET /api/usage/unavailable-accounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only active Codex accounts whose stored status is unavailable 401", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { id: "bad", provider: "codex", email: "bad@example.com", accessToken: "secret-a", isActive: true, testStatus: "unavailable", errorCode: 401 },
      { id: "duplicate", provider: "codex", email: "bad@example.com", isActive: true, testStatus: "unavailable", errorCode: "401" },
      { id: "good", provider: "codex", email: "good@example.com", accessToken: "secret-b", isActive: true, testStatus: "active" },
      { id: "limited", provider: "codex", email: "limited@example.com", isActive: true, testStatus: "unavailable", errorCode: 429 },
      { id: "off", provider: "codex", email: "off@example.com", accessToken: "secret-c", isActive: false, testStatus: "unavailable", errorCode: 401 },
    ]);

    const { GET } = await import("../../src/app/api/usage/unavailable-accounts/route.js");
    const response = await GET(new Request("http://localhost/api/usage/unavailable-accounts"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.getProviderConnections).toHaveBeenCalledWith({ provider: "codex" });
    expect(body).toEqual(["bad@example.com"]);
    expect(JSON.stringify(body)).not.toContain("secret-a");
  });

  it("can return inactive accounts and another stored status", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      { email: "limited@example.com", isActive: false, testStatus: "unavailable", errorCode: 429 },
    ]);

    const { GET } = await import("../../src/app/api/usage/unavailable-accounts/route.js");
    const response = await GET(new Request(
      "http://localhost/api/usage/unavailable-accounts?status=429&includeInactive=1",
    ));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(["limited@example.com"]);
  });

  it("validates the requested HTTP status", async () => {
    const { GET } = await import("../../src/app/api/usage/unavailable-accounts/route.js");
    const response = await GET(new Request("http://localhost/api/usage/unavailable-accounts?status=nope"));

    expect(response.status).toBe(400);
    expect(mocks.getProviderConnections).not.toHaveBeenCalled();
  });

  it("returns an error and always checks Codex when no account matches", async () => {
    mocks.getProviderConnections.mockResolvedValue([]);

    const { GET } = await import("../../src/app/api/usage/unavailable-accounts/route.js");
    const response = await GET(new Request("http://localhost/api/usage/unavailable-accounts?provider=claude"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "No matching Codex accounts found" });
    expect(mocks.getProviderConnections).toHaveBeenCalledWith({ provider: "codex" });
  });
});
