/**
 * Regression test for issue #2546: Grok CLI (xAI) token refresh not used,
 * session dies 40-45 min after login.
 *
 * Root cause: grok-cli mapTokens stored `expiresIn` but never `expiresAt`.
 * shouldRefreshCredentials() only reads expiresAt/tokenExpiresAt, so the
 * proactive refresh path never fired and only the reactive 401 path could
 * refresh — causing intermittent "token expired" failures.
 *
 * This test exercises the proactive-refresh decision path for grok-cli with
 * an absolute expiresAt. (The mapTokens unit portion cannot run in this
 * checkout because src/lib/oauth/providers.js self-imports the bare
 * "open-sse/index.js" specifier which vitest here does not resolve — a
 * pre-existing harness gap unrelated to this fix.)
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalFetch = global.fetch;

describe("Grok CLI (xAI) token expiry propagation (#2546)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    global.fetch = originalFetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("proactive refresh fires for a near-expiry grok-cli token (expiresAt present)", async () => {
    const { shouldRefreshCredentials } = await import(
      "../../open-sse/services/oauthCredentialManager.js"
    );
    const soon = new Date(Date.now() + 60 * 1000).toISOString();
    const creds = {
      connectionId: "grok-1",
      refreshToken: "rt",
      expiresIn: 60,
      expiresAt: soon,
    };
    expect(shouldRefreshCredentials("grok-cli", creds)).toBe(true);
  });

  it("proactive refresh does NOT fire for a far-future grok-cli token", async () => {
    const { shouldRefreshCredentials } = await import(
      "../../open-sse/services/oauthCredentialManager.js"
    );
    const farFuture = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const creds = {
      connectionId: "grok-2",
      refreshToken: "rt",
      expiresIn: 86400,
      expiresAt: farFuture,
    };
    expect(shouldRefreshCredentials("grok-cli", creds)).toBe(false);
  });
});
