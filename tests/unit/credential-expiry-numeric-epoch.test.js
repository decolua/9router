/**
 * Regression test: a credential whose `expiresAt` is a numeric epoch *string*
 * must still drive the proactive/background OAuth refresh.
 *
 * Same failure mode as #2546 ("session dies 40-45 min after login"), reached
 * through a different input shape. `parseTimeMs()` in
 * open-sse/services/oauthCredentialManager.js handled `number` and date-like
 * strings, but `new Date("1789012345678")` is an Invalid Date, so a numeric
 * string returned `null`. With a null expiry:
 *   - shouldRefreshCredentials() returns false  → on-request refresh never fires
 *   - selectConnectionsNeedingRefresh() skips it → background sweep never fires
 * and the connection keeps an expired access token until the user re-auths.
 *
 * Unnormalized numeric epochs reach the DB through the bulk-import routes,
 * which persist the user-supplied value verbatim:
 *   src/app/api/oauth/grok-cli/bulk-import/route.js  (raw.expires_at)
 *   src/app/api/oauth/codex/bulk-import/route.js     (item.expiresAt)
 * compare src/lib/oauth/kiroExternalIdp.js#resolveExpiresAt, which normalizes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const NOW = Date.parse("2026-08-01T12:00:00.000Z");

describe("numeric-epoch expiresAt (string form)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  describe("getCredentialExpiryMs", () => {
    it("parses epoch milliseconds given as a string", async () => {
      const { getCredentialExpiryMs } = await import(
        "../../open-sse/services/oauthCredentialManager.js"
      );
      const ms = NOW + 10 * 60 * 1000;
      expect(getCredentialExpiryMs({ expiresAt: String(ms) })).toBe(ms);
    });

    it("parses epoch seconds given as a string", async () => {
      const { getCredentialExpiryMs } = await import(
        "../../open-sse/services/oauthCredentialManager.js"
      );
      const seconds = Math.floor((NOW + 10 * 60 * 1000) / 1000);
      expect(getCredentialExpiryMs({ expiresAt: String(seconds) })).toBe(seconds * 1000);
    });

    it("still parses ISO strings and numbers, and rejects garbage", async () => {
      const { getCredentialExpiryMs } = await import(
        "../../open-sse/services/oauthCredentialManager.js"
      );
      const ms = NOW + 10 * 60 * 1000;
      expect(getCredentialExpiryMs({ expiresAt: new Date(ms).toISOString() })).toBe(ms);
      expect(getCredentialExpiryMs({ expiresAt: ms })).toBe(ms);
      expect(getCredentialExpiryMs({ expiresAt: "not-a-date" })).toBeNull();
      expect(getCredentialExpiryMs({ expiresAt: "" })).toBeNull();
      expect(getCredentialExpiryMs({})).toBeNull();
    });
  });

  describe("shouldRefreshCredentials", () => {
    it("fires for a near-expiry token whose expiresAt is a numeric string", async () => {
      const { shouldRefreshCredentials } = await import(
        "../../open-sse/services/oauthCredentialManager.js"
      );
      const creds = {
        connectionId: "grok-1",
        refreshToken: "rt",
        expiresAt: String(NOW + 60 * 1000),
      };
      expect(shouldRefreshCredentials("grok-cli", creds)).toBe(true);
    });

    it("does not fire for a far-future token whose expiresAt is a numeric string", async () => {
      const { shouldRefreshCredentials } = await import(
        "../../open-sse/services/oauthCredentialManager.js"
      );
      const creds = {
        connectionId: "grok-2",
        refreshToken: "rt",
        expiresAt: String(NOW + 30 * 24 * 60 * 60 * 1000),
      };
      expect(shouldRefreshCredentials("grok-cli", creds)).toBe(false);
    });
  });

  describe("selectConnectionsNeedingRefresh", () => {
    it("selects a connection whose expiresAt is a numeric epoch string", async () => {
      const { selectConnectionsNeedingRefresh } = await import(
        "../../src/sse/services/backgroundTokenRefresh.js"
      );
      const list = selectConnectionsNeedingRefresh(
        [
          {
            id: "c1",
            provider: "grok-cli",
            authType: "oauth",
            refreshToken: "rt-1",
            expiresAt: String(NOW + 10 * 60 * 1000),
            isActive: true,
          },
        ],
        NOW
      );
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe("c1");
    });
  });
});
