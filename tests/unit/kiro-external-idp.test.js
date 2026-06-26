import { describe, it, expect, vi, afterEach } from "vitest";
import {
  buildExternalIdpAuthorizeUrl,
  buildKiroHostedSsoUrl,
  discoverExternalIdpEndpoints,
  validateExternalIdpEndpoint,
} from "@/lib/oauth/services/kiroHostedSso";
import { KiroService } from "@/lib/oauth/services/kiro";

describe("Kiro hosted SSO", () => {
  it("builds the Kiro hosted sign-in URL used by the IDE", () => {
    const url = buildKiroHostedSsoUrl({
      codeChallenge: "challenge-xyz",
      state: "state-abc",
    });
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe("https://app.kiro.dev/signin");
    expect(parsed.searchParams.get("code_challenge")).toBe("challenge-xyz");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("state")).toBe("state-abc");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://localhost:3128");
    expect(parsed.searchParams.get("redirect_from")).toBe("KiroIDE");
  });

  it("builds the enterprise IdP leg authorize URL from portal descriptor", () => {
    const url = buildExternalIdpAuthorizeUrl({
      authorizationEndpoint: "https://login.microsoftonline.com/t/oauth2/v2.0/authorize",
      clientId: "azure-client",
      redirectUri: "http://localhost:3128/oauth/callback",
      scopes: "openid profile offline_access api://x/codewhisperer:conversations",
      codeChallenge: "leg2-challenge",
      state: "leg2-state",
      loginHint: "user@example.com",
    });
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe(
      "https://login.microsoftonline.com/t/oauth2/v2.0/authorize"
    );
    expect(parsed.searchParams.get("client_id")).toBe("azure-client");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://localhost:3128/oauth/callback");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("state")).toBe("leg2-state");
    expect(parsed.searchParams.get("login_hint")).toBe("user@example.com");
  });

  it("allow-lists Microsoft Entra hosts and rejects lookalikes", () => {
    expect(() => validateExternalIdpEndpoint("https://login.microsoftonline.com/t/v2.0")).not.toThrow();
    expect(() => validateExternalIdpEndpoint("https://login.microsoftonline.us/t/v2.0")).not.toThrow();
    expect(() => validateExternalIdpEndpoint("http://login.microsoftonline.com/t/v2.0")).toThrow(/https/);
    expect(() => validateExternalIdpEndpoint("https://evil-microsoftonline.com/t/v2.0")).toThrow(/not allow-listed/);
    expect(() => validateExternalIdpEndpoint("https://login.microsoftonline.com.evil.co/t/v2.0")).toThrow(/not allow-listed/);
  });

  it("discovers and validates external IdP OIDC endpoints", async () => {
    vi.stubGlobal("fetch", async (url, init) => {
      expect(url).toBe("https://login.microsoftonline.com/t/v2.0/.well-known/openid-configuration");
      expect(init.redirect).toBe("manual");
      return new Response(JSON.stringify({
        authorization_endpoint: "https://login.microsoftonline.com/t/oauth2/v2.0/authorize",
        token_endpoint: "https://login.microsoftonline.com/t/oauth2/v2.0/token",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const endpoints = await discoverExternalIdpEndpoints("https://login.microsoftonline.com/t/v2.0");
    expect(endpoints.authorizationEndpoint).toMatch(/authorize$/);
    expect(endpoints.tokenEndpoint).toMatch(/token$/);
  });

  it("tags ListAvailableProfiles requests for external IdP tokens", async () => {
    vi.stubGlobal("fetch", async (url, init) => {
      expect(url).toBe("https://codewhisperer.us-east-1.amazonaws.com");
      expect(init.headers.tokentype).toBe("EXTERNAL_IDP");
      expect(init.headers.Authorization).toBe("Bearer access-token");
      return new Response(JSON.stringify({
        profiles: [{ arn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/EXTERNAL" }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    const kiro = new KiroService();
    const profileArn = await kiro.listAvailableProfiles("access-token", "us-east-1", {
      authMethod: "external_idp",
    });
    expect(profileArn).toBe("arn:aws:codewhisperer:us-east-1:123456789012:profile/EXTERNAL");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
