import { describe, it, expect, vi, beforeEach } from "vitest";
import { probeProviderConnection } from "../providerProbe";

// Mock the providers constants
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {
    opencode: { noAuth: true },
  },
  AI_PROVIDERS: {
    opencode: { noAuth: true },
    openai: { id: "openai" },
    anthropic: { id: "anthropic" },
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("probeProviderConnection", () => {
  it("skips no-auth providers", async () => {
    const result = await probeProviderConnection({ provider: "opencode", authType: "apikey" });
    expect(result.valid).toBe(true);
    expect(result.skipped).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("skips oauth connection with no access token", async () => {
    const result = await probeProviderConnection({
      provider: "claude-code",
      authType: "oauth",
      accessToken: null,
    });
    expect(result.valid).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.error).toMatch(/access token/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("skips oauth connection with valid (non-expired) token", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h from now
    const result = await probeProviderConnection({
      provider: "claude-code",
      authType: "oauth",
      accessToken: "valid-token",
      expiresAt: future,
    });
    expect(result.valid).toBe(true);
    expect(result.skipped).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns invalid for oauth token expiring soon", async () => {
    const nearFuture = new Date(Date.now() + 60 * 1000).toISOString(); // 1 min from now
    const result = await probeProviderConnection({
      provider: "claude-code",
      authType: "oauth",
      accessToken: "expiring-token",
      expiresAt: nearFuture,
    });
    expect(result.valid).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.error).toMatch(/expir/i);
  });

  it("returns invalid when fetch returns 401", async () => {
    mockFetch.mockResolvedValueOnce({ status: 401 });
    const result = await probeProviderConnection({
      provider: "openai",
      authType: "apikey",
      apiKey: "bad-key",
    });
    expect(result.valid).toBe(false);
    expect(result.statusCode).toBe(401);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("returns valid when fetch returns 200", async () => {
    mockFetch.mockResolvedValueOnce({ status: 200 });
    const result = await probeProviderConnection({
      provider: "openai",
      authType: "apikey",
      apiKey: "sk-valid",
    });
    expect(result.valid).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.error).toBeNull();
  });

  it("returns invalid with error=timeout on AbortError", async () => {
    mockFetch.mockRejectedValueOnce(Object.assign(new Error("aborted"), { name: "AbortError" }));
    const result = await probeProviderConnection(
      { provider: "openai", authType: "apikey", apiKey: "sk-test" },
      50
    );
    expect(result.valid).toBe(false);
    expect(result.error).toBe("timeout");
  });

  it("skips provider with no probe definition", async () => {
    const result = await probeProviderConnection({
      provider: "unknown-provider-xyz",
      authType: "apikey",
      apiKey: "some-key",
    });
    expect(result.valid).toBe(true);
    expect(result.skipped).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns invalid when no apiKey is set for apikey authType", async () => {
    const result = await probeProviderConnection({
      provider: "openai",
      authType: "apikey",
      apiKey: null,
    });
    expect(result.valid).toBe(false);
    expect(result.skipped).toBe(false);
  });
});
