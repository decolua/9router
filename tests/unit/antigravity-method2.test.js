import { describe, it, expect, vi, beforeEach } from "vitest";
import antigravityProvider from "../../src/lib/oauth/providers/antigravity.js";

describe("Antigravity Method 2 - Direct Import & Enhanced Exchange", () => {
  const dummyConfig = {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    tokenUrl: "https://oauth2.googleapis.com/token",
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("handles Method 2: direct Google refresh token (starts with 1//)", async () => {
    const mockRefreshToken = "1//04test_refresh_token_xyz";
    const mockGoogleResponse = {
      access_token: "ya29.new_access_token",
      expires_in: 3600,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      token_type: "Bearer",
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockGoogleResponse,
    });

    const result = await antigravityProvider.exchangeToken(dummyConfig, mockRefreshToken);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    expect(options.method).toBe("POST");
    expect(options.body.toString()).toContain("grant_type=refresh_token");
    expect(options.body.toString()).toContain("refresh_token=1%2F%2F04test_refresh_token_xyz");

    expect(result.access_token).toBe("ya29.new_access_token");
    expect(result.refresh_token).toBe(mockRefreshToken);
  });

  it("handles Method 2: direct Google access token (starts with ya29.)", async () => {
    const mockAccessToken = "ya29.a0direct_access_token_123";
    global.fetch = vi.fn();

    const result = await antigravityProvider.exchangeToken(dummyConfig, mockAccessToken);

    // No need to hit Google tokenUrl if it's already an access token
    expect(global.fetch).not.toHaveBeenCalled();
    expect(result.access_token).toBe(mockAccessToken);
    expect(result.token_type).toBe("Bearer");
  });

  it("handles Method 2: JSON credentials string", async () => {
    const jsonPayload = JSON.stringify({
      refresh_token: "1//04json_refresh_token",
      project_id: "my-custom-gcp-project",
    });

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "ya29.from_json_refresh",
        expires_in: 3600,
      }),
    });

    const result = await antigravityProvider.exchangeToken(dummyConfig, jsonPayload);

    expect(result.access_token).toBe("ya29.from_json_refresh");
    expect(result.refresh_token).toBe("1//04json_refresh_token");
    expect(result.projectId).toBe("my-custom-gcp-project");
  });

  it("handles Method 1: URL-encoded authorization code (4%2F0A...)", async () => {
    const encodedAuthCode = "4%2F0AY0e-test_encoded_code";

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: "ya29.from_auth_code",
        refresh_token: "1//04auth_refresh",
        expires_in: 3600,
      }),
    });

    const result = await antigravityProvider.exchangeToken(
      dummyConfig,
      encodedAuthCode,
      "http://localhost:20128/callback"
    );

    const [url, options] = global.fetch.mock.calls[0];
    expect(options.body.toString()).toContain("grant_type=authorization_code");
    expect(options.body.toString()).toContain("code=4%2F0AY0e-test_encoded_code");
    expect(result.access_token).toBe("ya29.from_auth_code");
    expect(result.refresh_token).toBe("1//04auth_refresh");
  });

  it("postExchange gracefully handles Google Code Assist API errors without blocking", async () => {
    const tokens = {
      access_token: "ya29.test_token",
      refresh_token: "1//04test_refresh",
    };

    global.fetch = vi.fn().mockImplementation(async (url) => {
      if (url.includes("userinfo")) {
        return {
          ok: true,
          json: async () => ({ email: "test@example.com" }),
        };
      }
      // loadCodeAssist endpoint fails (e.g. 403 or network failure)
      return {
        ok: false,
        status: 403,
      };
    });

    const extra = await antigravityProvider.postExchange(tokens);

    expect(extra.userInfo.email).toBe("test@example.com");
    // projectId should remain empty string rather than crashing
    expect(extra.projectId).toBe("");

    const mapped = antigravityProvider.mapTokens(tokens, extra);
    expect(mapped.email).toBe("test@example.com");
    expect(mapped.accessToken).toBe("ya29.test_token");
    expect(mapped.refreshToken).toBe("1//04test_refresh");
  });
});
