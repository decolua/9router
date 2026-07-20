import { describe, expect, it } from "vitest";

const secrets = [
  "relay-user",
  "relay-password",
  "SECRET-AUTH-CODE",
  "SECRET-ACCESS-TOKEN",
  "SECRET-REFRESH-TOKEN",
  "SECRET-PKCE-VERIFIER",
  "SECRET-OAUTH-STATE",
  "provider-body-secret",
];
const credentialError = new Error(
  "exchange failed at https://relay-user:relay-password@relay.test/callback" +
  "?code=SECRET-AUTH-CODE&access_token=SECRET-ACCESS-TOKEN" +
  "&refresh_token=SECRET-REFRESH-TOKEN#SECRET-OAUTH-STATE " +
  "code_verifier=SECRET-PKCE-VERIFIER body=provider-body-secret",
);

describe("OAuth error sanitization", () => {
  it("returns a bounded actionable message without provider secrets", async () => {
    const oauthErrorModule = await import("../../open-sse/utils/oauthError.js").catch(() => null);
    const message = oauthErrorModule?.sanitizeOAuthError?.(credentialError);

    expect(message).toMatch(/restart sign-in|try again/i);
    expect(message.length).toBeLessThanOrEqual(240);
    for (const secret of secrets) expect(message).not.toContain(secret);
  });
});

export { credentialError, secrets };
