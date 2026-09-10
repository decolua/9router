import { describe, expect, it } from "vitest";

import {
  CODEX_LOOPBACK_REDIRECT_URI,
  hasMatchingOAuthState,
  isLoopbackBrowserHostname,
} from "../../src/shared/utils/oauthBrowserFlow.js";

describe("hosted Codex browser OAuth flow", () => {
  it("keeps the Codex CLI loopback redirect URI", () => {
    expect(CODEX_LOOPBACK_REDIRECT_URI).toBe("http://localhost:1455/auth/callback");
  });

  it.each(["localhost", "127.0.0.1", "::1", "[::1]"])(
    "allows the local callback proxy on %s",
    (hostname) => {
      expect(isLoopbackBrowserHostname(hostname)).toBe(true);
    }
  );

  it.each(["router.example", "ninerouter-render-xvkc.onrender.com", "192.168.1.10", ""])(
    "uses manual callback entry on remote host %s",
    (hostname) => {
      expect(isLoopbackBrowserHostname(hostname)).toBe(false);
    }
  );

  it("requires an exact non-empty state match before exchange", () => {
    expect(hasMatchingOAuthState("expected", "expected")).toBe(true);
    expect(hasMatchingOAuthState("expected", "different")).toBe(false);
    expect(hasMatchingOAuthState("expected", null)).toBe(false);
    expect(hasMatchingOAuthState(null, null)).toBe(false);
  });
});
