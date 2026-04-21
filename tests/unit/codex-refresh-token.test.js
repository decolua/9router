/**
 * Unit tests for Codex (OpenAI) refresh token mechanism
 *
 * Verifies that:
 * - Early refresh lead times are configured per provider (synced with CLIProxyAPI)
 * - New refresh_token from response is persisted (token rotation)
 * - Falls back to old refresh_token when server doesn't return new one
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const originalFetch = global.fetch;

vi.mock("../../open-sse/index.js", () => ({}));

describe("Codex Refresh Token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("refreshCodexToken", () => {
    it("should return new refresh_token when server provides one (token rotation)", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: "new-access",
          refresh_token: "rotated-refresh-token",
          expires_in: 3600,
        }),
      });

      const { refreshCodexToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshCodexToken("old-refresh-token", null);

      expect(result.refreshToken).toBe("rotated-refresh-token");
      expect(result.accessToken).toBe("new-access");
    });

    it("should keep old refresh_token when server does not return new one", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: "new-access",
          expires_in: 3600,
        }),
      });

      const { refreshCodexToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshCodexToken("old-refresh-token", null);

      expect(result.refreshToken).toBe("old-refresh-token");
    });
  });

  describe("getRefreshLeadMs (early refresh config)", () => {
    it("should return provider-specific lead time for OAuth providers", async () => {
      const { getRefreshLeadMs } = await import("../../open-sse/services/tokenRefresh.js");

      // Synced with CLIProxyAPI refresh_registry
      expect(getRefreshLeadMs("codex")).toBe(5 * 24 * 60 * 60 * 1000);   // 5 days
      expect(getRefreshLeadMs("claude")).toBe(4 * 60 * 60 * 1000);       // 4 hours
      expect(getRefreshLeadMs("iflow")).toBe(24 * 60 * 60 * 1000);       // 24 hours
      expect(getRefreshLeadMs("qwen")).toBe(20 * 60 * 1000);             // 20 minutes
      expect(getRefreshLeadMs("kimi-coding")).toBe(5 * 60 * 1000);       // 5 minutes
      expect(getRefreshLeadMs("antigravity")).toBe(5 * 60 * 1000);       // 5 minutes
    });

    it("should fallback to default buffer for unknown providers", async () => {
      const { getRefreshLeadMs, TOKEN_EXPIRY_BUFFER_MS } = await import("../../open-sse/services/tokenRefresh.js");

      expect(getRefreshLeadMs("unknown-provider")).toBe(TOKEN_EXPIRY_BUFFER_MS);
      expect(getRefreshLeadMs("openai")).toBe(TOKEN_EXPIRY_BUFFER_MS);
    });

    it("codex lead should be greater than default buffer", async () => {
      const { getRefreshLeadMs, TOKEN_EXPIRY_BUFFER_MS } = await import("../../open-sse/services/tokenRefresh.js");

      expect(getRefreshLeadMs("codex")).toBeGreaterThan(TOKEN_EXPIRY_BUFFER_MS);
    });
  });

  describe("Codex identity mapping", () => {
    it("prefers email/name from id_token so add-account saves a real label", async () => {
      const jwt = (payload) => {
        const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
        const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
        return `${header}.${body}.sig`;
      };

      const { getProvider } = await import("../../src/lib/oauth/providers.js");
      const provider = getProvider("codex");

      const result = provider.mapTokens({
        access_token: jwt({ sub: "opaque-sub" }),
        refresh_token: "refresh-token",
        id_token: jwt({ email: "codex.user@example.com", name: "Codex User" }),
        expires_in: 3600,
      });

      expect(result.email).toBe("codex.user@example.com");
      expect(result.name).toBe("codex.user@example.com");
      expect(result.displayName).toBe("Codex User");
    });
  });
});
