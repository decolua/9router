import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("jose", () => ({
  importPKCS8: vi.fn(async () => "private-key"),
  SignJWT: class SignJWT {
    setProtectedHeader() { return this; }
    setIssuer() { return this; }
    setAudience() { return this; }
    setIssuedAt() { return this; }
    setExpirationTime() { return this; }
    async sign() { return "signed-jwt"; }
  },
}));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  normalizeExplicitProxyOptions: (options) => options,
  proxyAwareFetch: vi.fn(),
}));

const originalFetch = globalThis.fetch;
const proxyRoute = {
  source: "pool",
  proxyPoolId: "vertex-dispatch-pool",
  connectionProxyEnabled: true,
  connectionProxyUrl: "http://proxy.test:8080",
  strictProxy: true,
  disableEnvProxy: true,
};

describe("Vertex refresh dispatcher proxy routing", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      access_token: "vertex-access-token",
      expires_in: 3600,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("passes the route from generic dispatch into Vertex token minting", async () => {
    const { refreshTokenByProvider } = await import("../../open-sse/services/tokenRefresh.js");
    const serviceAccount = JSON.stringify({
      type: "service_account",
      client_email: "vertex-dispatch-unique@example.test",
      private_key: "private-key",
      project_id: "vertex-project",
    });

    const result = await refreshTokenByProvider("vertex", {
      apiKey: serviceAccount,
      refreshToken: "dispatch-sentinel",
    }, console, proxyRoute);

    expect(result).toMatchObject({ accessToken: "vertex-access-token" });
    expect(globalThis.fetch.mock.calls[0][1].proxyOptions).toBe(proxyRoute);
  });
});
