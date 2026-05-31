import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

vi.mock("@/models", () => ({
  createProviderConnection: vi.fn(async (input) => ({ id: "kiro-social-1", ...input })),
}));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { KiroService } from "../../src/lib/oauth/services/kiro.js";
import { createProviderConnection } from "@/models";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

function request(urlOrBody, body) {
  if (typeof urlOrBody === "string") return { url: urlOrBody };
  return { json: vi.fn(async () => urlOrBody ?? body) };
}

function jwtWithEmail(email) {
  const payload = Buffer.from(JSON.stringify({ email })).toString("base64url");
  return `header.${payload}.signature`;
}

describe("Kiro social OAuth service", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("builds Google and GitHub social login URLs through Kiro desktop auth", () => {
    const service = new KiroService();

    const googleUrl = new URL(service.buildSocialLoginUrl("google", "challenge-1", "state-1"));
    expect(googleUrl.origin).toBe("https://prod.us-east-1.auth.desktop.kiro.dev");
    expect(googleUrl.pathname).toBe("/login");
    expect(googleUrl.searchParams.get("idp")).toBe("Google");
    expect(googleUrl.searchParams.get("redirect_uri")).toBe("http://localhost:3128/oauth/callback?login_option=google");
    expect(googleUrl.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(googleUrl.searchParams.get("code_challenge_method")).toBe("S256");
    expect(googleUrl.searchParams.get("state")).toBe("state-1");

    const githubUrl = new URL(service.buildSocialLoginUrl("github", "challenge-2", "state-2"));
    expect(githubUrl.searchParams.get("idp")).toBe("Github");
    expect(githubUrl.searchParams.get("redirect_uri")).toBe("http://localhost:3128/oauth/callback?login_option=github");
  });

  it("exchanges social authorization codes via Kiro desktop oauth/token", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        accessToken: "access-1",
        refreshToken: "refresh-1",
        idToken: "id-1",
        profileArn: "profile-1",
        expiresIn: 7200,
      }),
    }));

    const service = new KiroService();
    const result = await service.exchangeSocialCode("code-1", "verifier-1", "github");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://prod.us-east-1.auth.desktop.kiro.dev/oauth/token",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    );
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body).toEqual({
      code: "code-1",
      code_verifier: "verifier-1",
      redirect_uri: "http://localhost:3128/oauth/callback?login_option=github",
    });
    expect(result).toMatchObject({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      profileArn: "profile-1",
      expiresIn: 7200,
      authMethod: "social",
      socialProvider: "github",
    });
  });

  it("refreshes social tokens through AWS Cognito when authMethod=social", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ access_token: "new-access", refresh_token: "new-refresh", expires_in: 3600 }),
    }));

    const service = new KiroService();
    const result = await service.refreshToken("old-refresh", { authMethod: "social" });

    expect(global.fetch).toHaveBeenCalledWith(
      "https://kiro-prod-us-east-1.auth.us-east-1.amazoncognito.com/oauth2/token",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      })
    );
    const body = new URLSearchParams(global.fetch.mock.calls[0][1].body);
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("client_id")).toBe("59bd15eh40ee7pc20h0bkcu7id");
    expect(body.get("refresh_token")).toBe("old-refresh");
    expect(result).toMatchObject({ accessToken: "new-access", refreshToken: "new-refresh", expiresIn: 3600 });
  });
});

describe("Kiro social OAuth routes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("GET /api/oauth/kiro/social-authorize returns auth URL and PKCE state", async () => {
    const { GET } = await import("../../src/app/api/oauth/kiro/social-authorize/route.js");

    const res = await GET(request("http://localhost/api/oauth/kiro/social-authorize?provider=google"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.provider).toBe("google");
    expect(body.authUrl).toContain("https://prod.us-east-1.auth.desktop.kiro.dev/login?");
    expect(body.codeVerifier).toBeTruthy();
    expect(body.codeChallenge).toBeTruthy();
    expect(body.state).toBeTruthy();
  });

  it("GET /api/oauth/kiro/social-authorize rejects invalid providers", async () => {
    const { GET } = await import("../../src/app/api/oauth/kiro/social-authorize/route.js");

    const res = await GET(request("http://localhost/api/oauth/kiro/social-authorize?provider=facebook"));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Invalid provider");
  });

  it("POST /api/oauth/kiro/social-exchange persists social credentials", async () => {
    const accessToken = jwtWithEmail("kiro@example.com");
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        accessToken,
        refreshToken: "refresh-social",
        profileArn: "profile-social",
        expiresIn: 3600,
      }),
    }));

    const { POST } = await import("../../src/app/api/oauth/kiro/social-exchange/route.js");
    const res = await POST(request({ code: "code-social", codeVerifier: "verifier-social", provider: "google" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(createProviderConnection).toHaveBeenCalledWith(expect.objectContaining({
      provider: "kiro",
      authType: "oauth",
      accessToken,
      refreshToken: "refresh-social",
      email: "kiro@example.com",
      providerSpecificData: expect.objectContaining({
        profileArn: "profile-social",
        authMethod: "social",
        socialProvider: "google",
        provider: "Google",
      }),
      testStatus: "active",
    }));
  });

  it("POST /api/oauth/kiro/social-exchange rejects invalid provider", async () => {
    const { POST } = await import("../../src/app/api/oauth/kiro/social-exchange/route.js");
    const res = await POST(request({ code: "code", codeVerifier: "verifier", provider: "facebook" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Invalid provider");
    expect(createProviderConnection).not.toHaveBeenCalled();
  });
});

describe("runtime Kiro social token refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses Cognito for authMethod=social in open-sse token refresh", async () => {
    proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: "runtime-access", refresh_token: "runtime-refresh", expires_in: 1800 }),
    });

    const { refreshKiroToken } = await import("../../open-sse/services/tokenRefresh.js");
    const result = await refreshKiroToken("runtime-old-refresh", { authMethod: "social" }, { info: vi.fn(), error: vi.fn() });

    expect(proxyAwareFetch).toHaveBeenCalledWith(
      "https://kiro-prod-us-east-1.auth.us-east-1.amazoncognito.com/oauth2/token",
      expect.objectContaining({ method: "POST" }),
      null
    );
    const body = new URLSearchParams(proxyAwareFetch.mock.calls[0][1].body);
    expect(body.get("client_id")).toBe("59bd15eh40ee7pc20h0bkcu7id");
    expect(body.get("refresh_token")).toBe("runtime-old-refresh");
    expect(result).toEqual({
      accessToken: "runtime-access",
      refreshToken: "runtime-refresh",
      expiresIn: 1800,
    });
  });
});
