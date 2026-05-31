import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { requestDeviceCode, pollForToken } from "../../src/lib/oauth/providers.js";

describe("Freebuff OAuth provider", () => {
  const originalFetch = global.fetch;
  const originalNow = Date.now;

  beforeEach(() => {
    Date.now = vi.fn(() => 1_000);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    Date.now = originalNow;
    vi.restoreAllMocks();
  });

  it("requests a device code using the Freebuff CLI auth endpoint", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        loginUrl: "https://freebuff.com/login/abc",
        fingerprintHash: "hash-1",
        expiresAt: 301_000,
      }),
    }));

    const data = await requestDeviceCode("freebuff", undefined, { authMethod: "freebuff" });
    const code = JSON.parse(data.device_code);

    expect(global.fetch).toHaveBeenCalledWith("https://freebuff.com/api/auth/cli/code", expect.objectContaining({ method: "POST" }));
    expect(code.fingerprintHash).toBe("hash-1");
    expect(code.authMethod).toBe("freebuff");
    expect(data.verification_uri).toBe("https://freebuff.com/login/abc");
    expect(data.expires_in).toBe(300);
  });

  it("polls approved tokens and maps them into connection credentials", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        user: {
          authToken: "fb-token",
          email: "user@example.com",
          id: "u1",
          name: "User",
        },
      }),
    }));

    const deviceCode = JSON.stringify({
      fingerprintId: "fb-test",
      fingerprintHash: "hash-1",
      expiresAt: 301_000,
      authMethod: "freebuff",
    });

    const result = await pollForToken("freebuff", deviceCode);

    expect(result.success).toBe(true);
    expect(result.tokens.accessToken).toBe("fb-token");
    expect(result.tokens.email).toBe("user@example.com");
    expect(result.tokens.providerSpecificData.authMethod).toBe("freebuff");
    expect(result.tokens.refreshToken).toBeNull();
  });

  it("returns pending while user has not approved the device code yet", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));

    const deviceCode = JSON.stringify({
      fingerprintId: "fb-test",
      fingerprintHash: "hash-1",
      expiresAt: 301_000,
      authMethod: "freebuff",
    });

    const result = await pollForToken("freebuff", deviceCode);

    expect(result.success).toBe(false);
    expect(result.pending).toBe(true);
    expect(result.error).toBe("authorization_pending");
  });
});
