import { beforeEach, describe, expect, it, vi } from "vitest";

const DISCOVERY_URL = "https://auth.x.ai/.well-known/openid-configuration";

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

/**
 * Install a URL-dispatched fetch stub.
 *
 * Responses are keyed by URL, never by call position: every known endpoint
 * always gets its own canned payload no matter how many calls happen or in
 * what order they happen, so a stray or out-of-order call can no longer
 * consume a queued response and leave a later call resolving `undefined`.
 *
 * An unrecognised URL resolves with a non-ok stub (recorded on
 * `mock.unmatchedStubs`) instead of rejecting, so a probe that the test does
 * not read cannot fail the suite; the fail-loud guarantee lives in the
 * URL-lookup assertions below, which fail when the expected call is absent.
 */
function stubFetch({ discovery, token } = {}) {
  const mock = vi.fn(async (url) => {
    const target = String(url);
    if (discovery && target.includes("openid-configuration")) return jsonResponse(discovery);
    if (token && target.includes("/oauth2/token")) return jsonResponse(token);
    mock.unmatchedStubs.push(target);
    return {
      ok: false,
      status: 404,
      json: async () => ({}),
      text: async () => `stub: unexpected fetch ${target}`,
    };
  });
  mock.unmatchedStubs = [];
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("xai/oauth service", () => {
  // Machine load on the fleet box routinely pushes this file past the 5s
  // default. The assertions are purely behavioural, so a larger budget only
  // removes load-induced false reds; call position is never asserted.
  vi.setConfig({ testTimeout: 30000 });

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("validates discovered endpoints are https x.ai URLs", async () => {
    const { validateOAuthEndpoint } = await import("../../src/lib/oauth/services/xai.js");

    expect(validateOAuthEndpoint("https://auth.x.ai/oauth2/authorize", "authorization_endpoint")).toBe(
      "https://auth.x.ai/oauth2/authorize"
    );
    expect(() => validateOAuthEndpoint("http://auth.x.ai/oauth2/authorize", "authorization_endpoint")).toThrow(
      /must use https/
    );
    expect(() => validateOAuthEndpoint("https://example.com/oauth2/authorize", "authorization_endpoint")).toThrow(
      /is not on x\.ai/
    );
  });

  it("discovers endpoints without custom user-agent headers", async () => {
    const fetchMock = stubFetch({
      discovery: {
        authorization_endpoint: "https://auth.x.ai/oauth2/authorize",
        token_endpoint: "https://auth.x.ai/oauth2/token",
      },
    });

    const { discoverEndpoints } = await import("../../src/lib/oauth/services/xai.js");
    await expect(discoverEndpoints()).resolves.toEqual({
      authorizeUrl: "https://auth.x.ai/oauth2/authorize",
      tokenUrl: "https://auth.x.ai/oauth2/token",
    });

    const discoveryCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("openid-configuration"));
    expect(discoveryCall).toBeTruthy();
    expect(discoveryCall[0]).toBe(DISCOVERY_URL);
    expect(discoveryCall[1]).toEqual(expect.objectContaining({ headers: { Accept: "application/json" } }));
  });

  it("builds authorize URLs with CLIProxyAPI query extras", async () => {
    const { XaiService } = await import("../../src/lib/oauth/services/xai.js");
    const authUrl = new XaiService().buildXaiAuthUrl(
      "http://127.0.0.1:56121/callback",
      "state-1",
      "challenge-1",
      "https://auth.x.ai/oauth2/authorize"
    );
    const parsed = new URL(authUrl);

    expect(parsed.origin + parsed.pathname).toBe("https://auth.x.ai/oauth2/authorize");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("client_id")).toBe("b1a00492-073a-47ea-816f-4c329264a828");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:56121/callback");
    expect(parsed.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("state")).toBe("state-1");
    expect(parsed.searchParams.get("nonce")).toMatch(/^[a-f0-9]{32}$/);
    expect(parsed.searchParams.get("plan")).toBe("generic");
    expect(parsed.searchParams.get("referrer")).toBe("cli-proxy-api");
  });

  it("generates dashboard auth data with CLIProxyAPI PKCE size and discovered endpoints", async () => {
    stubFetch({
      discovery: {
        authorization_endpoint: "https://auth.x.ai/oauth2/authorize-from-discovery",
        token_endpoint: "https://auth.x.ai/oauth2/token-from-discovery",
      },
    });

    const { generateAuthData } = await import("../../src/lib/oauth/providers.js");
    const data = await generateAuthData("xai", "http://127.0.0.1:56121/callback");
    const parsed = new URL(data.authUrl);

    expect(data.codeVerifier).toHaveLength(128);
    expect(parsed.origin + parsed.pathname).toBe("https://auth.x.ai/oauth2/authorize-from-discovery");
    expect(parsed.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:56121/callback");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("plan")).toBe("generic");
    expect(parsed.searchParams.get("referrer")).toBe("cli-proxy-api");
  });

  it("exchanges dashboard codes against the discovered xAI token endpoint", async () => {
    const fetchMock = stubFetch({
      discovery: {
        authorization_endpoint: "https://auth.x.ai/oauth2/authorize",
        token_endpoint: "https://auth.x.ai/oauth2/token-from-discovery",
      },
      token: {
        access_token: "access-token",
        refresh_token: "refresh-token",
        expires_in: 3600,
      },
    });

    const { exchangeTokens } = await import("../../src/lib/oauth/providers.js");
    const tokens = await exchangeTokens(
      "xai",
      "auth-code",
      "http://127.0.0.1:56121/callback",
      "verifier-1",
      "state-1"
    );

    const tokenCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/oauth2/token"));
    expect(tokenCall).toBeTruthy();
    expect(tokenCall[0]).toBe("https://auth.x.ai/oauth2/token-from-discovery");
    expect(tokenCall[1].body.get("grant_type")).toBe("authorization_code");
    expect(tokenCall[1].body.get("code")).toBe("auth-code");
    expect(tokenCall[1].body.get("code_verifier")).toBe("verifier-1");
    expect(tokens).toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresIn: 3600,
    });
  });
});
