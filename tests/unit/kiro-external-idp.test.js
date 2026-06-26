// Unit tests for KiroService external_idp (Microsoft Entra ID) methods.
//
// Run from 9router/tests:
//   npx vitest run kiro-external-idp.test.js
//
// Coverage:
//  - buildExternalIdpAuthUrl produces a well-formed authorize URL with PKCE params
//  - exchangeExternalIdpCode posts form-encoded body and parses the response
//  - refreshExternalIdpToken posts refresh_token grant
//  - startLoopbackCapture rejects on cancel
//
// fetch is mocked so these tests do not touch the network.

import { describe, it, expect, vi, afterEach } from "vitest";
import { KiroService } from "@/lib/oauth/services/kiro";

describe("KiroService.buildExternalIdpAuthUrl", () => {
  it("includes PKCE + state + scopes", () => {
    const kiro = new KiroService();
    const url = kiro.buildExternalIdpAuthUrl({
      issuerUrl: "https://login.microsoftonline.com/common/v2.0",
      clientId: "00000003-0000-0000-c000-000000000000",
      codeChallenge: "challenge-xyz",
      state: "state-abc",
    });
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe(
      "https://login.microsoftonline.com/common/v2.0/oauth2/v2.0/authorize"
    );
    expect(parsed.searchParams.get("client_id")).toBe("00000003-0000-0000-c000-000000000000");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("code_challenge")).toBe("challenge-xyz");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("state")).toBe("state-abc");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://localhost:3128/oauth/callback");
    expect(parsed.searchParams.get("scope")).toMatch(/openid/);
    expect(parsed.searchParams.get("response_mode")).toBe("query");
  });

  it("rejects when required fields missing", () => {
    const kiro = new KiroService();
    expect(() =>
      kiro.buildExternalIdpAuthUrl({ issuerUrl: "x", clientId: "y" })
    ).toThrow(/codeChallenge.*state/);
  });

  it("accepts fully-formed authEndpoint", () => {
    const kiro = new KiroService();
    const url = kiro.buildExternalIdpAuthUrl({
      issuerUrl: "https://login.microsoftonline.com/tenant/v2.0",
      authEndpoint: "https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize",
      clientId: "abc",
      codeChallenge: "cc",
      state: "ss",
    });
    expect(url).toMatch(
      /^https:\/\/login\.microsoftonline\.com\/tenant\/oauth2\/v2\.0\/authorize\?/
    );
  });
});

describe("KiroService.exchangeExternalIdpCode", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts form-encoded body and parses response", async () => {
    const kiro = new KiroService();
    let capturedUrl = null;
    let capturedInit = null;
    vi.stubGlobal("fetch", async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(
        JSON.stringify({
          access_token: "at",
          refresh_token: "rt",
          expires_in: 3600,
          id_token: "header.payload.sig",
          scope: "openid profile",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const result = await kiro.exchangeExternalIdpCode({
      issuerUrl: "https://login.microsoftonline.com/tenant/v2.0",
      clientId: "abc",
      code: "auth-code",
      codeVerifier: "verifier",
    });

    expect(result.accessToken).toBe("at");
    expect(result.refreshToken).toBe("rt");
    expect(result.expiresIn).toBe(3600);
    expect(result.idToken).toBe("header.payload.sig");

    expect(capturedUrl).toBe("https://login.microsoftonline.com/tenant/v2.0/oauth2/v2.0/token");
    expect(capturedInit.headers["Content-Type"]).toMatch(/application\/x-www-form-urlencoded/);
    const body = new URLSearchParams(capturedInit.body);
    expect(body.get("client_id")).toBe("abc");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("code_verifier")).toBe("verifier");
    expect(body.get("redirect_uri")).toBe("http://localhost:3128/oauth/callback");
  });

  it("throws when access_token missing in response", async () => {
    const kiro = new KiroService();
    vi.stubGlobal("fetch", async () =>
      new Response(JSON.stringify({ expires_in: 3600 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );
    await expect(
      kiro.exchangeExternalIdpCode({
        issuerUrl: "https://login.microsoftonline.com/t/v2.0",
        clientId: "x",
        code: "c",
        codeVerifier: "v",
      })
    ).rejects.toThrow(/missing access_token/);
  });
});

describe("KiroService.refreshExternalIdpToken", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts refresh_token grant and returns new tokens", async () => {
    const kiro = new KiroService();
    let capturedInit = null;
    vi.stubGlobal("fetch", async (_url, init) => {
      capturedInit = init;
      return new Response(
        JSON.stringify({ access_token: "new-at", refresh_token: "new-rt", expires_in: 3600 }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    });

    const result = await kiro.refreshExternalIdpToken("old-rt", {
      issuerUrl: "https://login.microsoftonline.com/tenant/v2.0",
      clientId: "abc",
      profileArn: "arn:aws:codewhisperer:us-east-1:000000000000:profile/test",
    });

    expect(result.accessToken).toBe("new-at");
    expect(result.refreshToken).toBe("new-rt");
    expect(result.profileArn).toBe("arn:aws:codewhisperer:us-east-1:000000000000:profile/test");
    const body = new URLSearchParams(capturedInit.body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("old-rt");
  });

  it("throws when issuerUrl/clientId missing", async () => {
    const kiro = new KiroService();
    await expect(kiro.refreshExternalIdpToken("rt", {})).rejects.toThrow(
      /requires issuerUrl and clientId/
    );
  });
});

describe("KiroService.startLoopbackCapture", () => {
  it("rejects when cancelled", async () => {
    const kiro = new KiroService();
    const { promise, cancel } = kiro.startLoopbackCapture({
      port: 0,
      host: "127.0.0.1",
      expectedState: "expected",
      timeoutMs: 5000,
    });
    setTimeout(cancel, 50);
    await expect(promise).rejects.toThrow(/cancelled/);
  });
});