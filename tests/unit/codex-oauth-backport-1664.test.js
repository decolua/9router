/**
 * Regression tests for backport of selected fixes from decolua/9router PR #1664:
 *  1. refreshCodexToken preserves idToken when OpenAI does not return a new id_token
 *  2. CodexExecutor.refreshCredentials() implemented (base class was a no-op),
 *     so a reactive 401/403 mid-request can actually recover the Codex token.
 *
 * dedupRefresh caches by `codex:<refreshToken>`, so each case uses a unique token.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const originalFetch = global.fetch;

describe("Codex OAuth refresh backport (PR #1664)", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => { global.fetch = originalFetch; });

  describe("refreshCodexToken idToken preservation", () => {
    it("keeps the current idToken when the server omits id_token", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: "acc-1", expires_in: 3600 }),
      });

      const { refreshCodexToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshCodexToken("rt-keep-idtoken-001", null, "existing-id-token");

      expect(result.accessToken).toBe("acc-1");
      expect(result.idToken).toBe("existing-id-token");
    });

    it("uses the new id_token when the server returns one", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: "acc-2", expires_in: 3600, id_token: "fresh-id-token" }),
      });

      const { refreshCodexToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshCodexToken("rt-new-idtoken-002", null, "stale-id-token");

      expect(result.idToken).toBe("fresh-id-token");
    });

    it("returns idToken null when neither server nor current token has one", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: "acc-3", expires_in: 3600 }),
      });

      const { refreshCodexToken } = await import("../../open-sse/services/tokenRefresh.js");
      const result = await refreshCodexToken("rt-null-idtoken-003", null);

      expect(result.idToken).toBeNull();
    });
  });

  describe("CodexExecutor.refreshCredentials", () => {
    it("recovers a Codex token reactively (no longer a no-op)", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: "reactive-acc", refresh_token: "reactive-rt", expires_in: 3600 }),
      });

      const { CodexExecutor } = await import("../../open-sse/executors/codex.js");
      const exec = new CodexExecutor();
      const result = await exec.refreshCredentials(
        { refreshToken: "rt-reactive-004", idToken: "kept-id" },
        null
      );

      expect(result.accessToken).toBe("reactive-acc");
      expect(result.refreshToken).toBe("reactive-rt");
      expect(result.idToken).toBe("kept-id");
    });

    it("returns null when no refreshToken is present", async () => {
      const { CodexExecutor } = await import("../../open-sse/executors/codex.js");
      const exec = new CodexExecutor();
      const result = await exec.refreshCredentials({ refreshToken: "" }, null);
      expect(result).toBeNull();
    });
  });
});
