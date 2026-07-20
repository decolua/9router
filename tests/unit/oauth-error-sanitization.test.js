import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const modalSource = readFileSync(fileURLToPath(new URL(
  "../../src/shared/components/OAuthModal.js",
  import.meta.url,
)), "utf8");
const kiroModalSource = readFileSync(fileURLToPath(new URL(
  "../../src/shared/components/KiroSocialOAuthModal.js",
  import.meta.url,
)), "utf8");
const callbackSource = readFileSync(fileURLToPath(new URL(
  "../../src/app/callback/page.js",
  import.meta.url,
)), "utf8");

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

  it("sanitizes callback errors before displaying them in either modal", () => {
    expect(callbackSource).toContain("error: error ? sanitizeOAuthError(error) : null");
    expect(callbackSource).toContain("errorDescription: errorDescription ? sanitizeOAuthError(errorDescription) : null");
    expect(modalSource).toContain("sanitizeOAuthError(errorDescription || callbackError)");
    expect(modalSource).toContain("sanitizeOAuthError(data.errorDescription || data.error)");
    expect(modalSource).toContain('sanitizeOAuthError(url.searchParams.get("error_description") || errorParam)');
    expect(modalSource).toContain('throw new Error("Invalid callback URL")');
    expect(kiroModalSource).toContain('sanitizeOAuthError(url.searchParams.get("error_description") || errorParam)');
  });
});

export { credentialError, secrets };
