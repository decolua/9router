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

function fakeJwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode(payload)}.signature`;
}

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

    it("should return refreshed Codex account metadata from id_token", async () => {
      const idToken = fakeJwt({
        "https://api.openai.com/profile": { email: "dev@example.com" },
        "https://api.openai.com/auth": {
          chatgpt_account_id: "workspace-business",
          chatgpt_plan_type: "business",
          chatgpt_user_id: "user-123",
          chatgpt_account_is_fedramp: true,
        },
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          access_token: "new-access",
          refresh_token: "rotated-refresh-token",
          expires_in: 3600,
          id_token: idToken,
        }),
      });

      const { refreshCodexToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshCodexToken("old-refresh-token", null);

      expect(result.idToken).toBe(idToken);
      expect(result.providerSpecificData).toEqual({
        chatgptAccountId: "workspace-business",
        chatgptPlanType: "business",
        chatgptUserId: "user-123",
        chatgptAccountIsFedramp: true,
      });
    });

    it("should not extract or store Codex workspace names from token claims", async () => {
      const idToken = fakeJwt({
        name: "Account Owner",
        "https://api.openai.com/auth": {
          chatgpt_account_id: "workspace-business",
          chatgpt_plan_type: "business",
          chatgpt_account_name: "Account Name",
          workspace_name: "Workspace Name",
          workspaces: [
            { id: "workspace-business", display_name: "Workspace Name" },
          ],
          organizations: [
            { id: "org-business", title: "Shared Org" },
          ],
        },
      });

      const { buildCodexProviderSpecificData } = await import("../../src/lib/oauth/codexClaims.js");
      expect(buildCodexProviderSpecificData({ id_token: idToken })).toEqual({
        chatgptAccountId: "workspace-business",
        chatgptPlanType: "business",
      });
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

  describe("Codex request headers", () => {
    it("should include selected ChatGPT workspace and FedRAMP headers", async () => {
      const { CodexExecutor } = await import("../../open-sse/executors/codex.js");
      const headers = new CodexExecutor().buildHeaders({
        accessToken: "access-token",
        providerSpecificData: {
          chatgptAccountId: "workspace-business",
          chatgptAccountIsFedramp: true,
        },
      });

      expect(headers.Authorization).toBe("Bearer access-token");
      expect(headers["ChatGPT-Account-ID"]).toBe("workspace-business");
      expect(headers["X-OpenAI-Fedramp"]).toBe("true");
    });
  });
});
