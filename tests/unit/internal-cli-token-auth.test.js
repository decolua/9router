import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getConsistentMachineId: vi.fn(),
  validateApiKey: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
  validateApiKey: mocks.validateApiKey,
  updateProviderConnection: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
}));

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: mocks.getConsistentMachineId,
}));

describe("internal CLI token API authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConsistentMachineId.mockResolvedValue("internal-cli-token");
    mocks.validateApiKey.mockResolvedValue(false);
  });

  it("accepts the server-generated token used by hosted model probes", async () => {
    const { hasValidCliToken } = await import("../../src/lib/auth/internalCliToken.js");
    const request = new Request("http://127.0.0.1/api/v1/chat/completions", {
      headers: { "x-9r-cli-token": "internal-cli-token" },
    });

    await expect(hasValidCliToken(request)).resolves.toBe(true);
    expect(mocks.getConsistentMachineId).toHaveBeenCalledWith("9r-cli-auth");
  });

  it("rejects missing or incorrect internal tokens", async () => {
    const { hasValidCliToken } = await import("../../src/lib/auth/internalCliToken.js");

    await expect(hasValidCliToken(new Request("http://127.0.0.1"))).resolves.toBe(false);
    await expect(hasValidCliToken(new Request("http://127.0.0.1", {
      headers: { "x-9r-cli-token": "wrong" },
    }))).resolves.toBe(false);
  });

  it("authorizes internal probes without accepting external keyless requests", async () => {
    const { isApiRequestAuthorized } = await import("../../src/sse/services/auth.js");

    await expect(isApiRequestAuthorized(new Request("http://127.0.0.1", {
      headers: { "x-9r-cli-token": "internal-cli-token" },
    }))).resolves.toBe(true);
    await expect(isApiRequestAuthorized(new Request("https://router.example"))).resolves.toBe(false);
  });

  it("still validates supplied gateway API keys", async () => {
    const { isApiRequestAuthorized } = await import("../../src/sse/services/auth.js");
    mocks.validateApiKey.mockResolvedValueOnce(true);

    const request = new Request("https://router.example", {
      headers: { authorization: "Bearer sk-router" },
    });
    await expect(isApiRequestAuthorized(request)).resolves.toBe(true);
    expect(mocks.validateApiKey).toHaveBeenCalledWith("sk-router");
  });
});
