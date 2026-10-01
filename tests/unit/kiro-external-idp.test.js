import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const originalFetch = global.fetch;
const TEST_CLIENT_ID = "00000000-0000-4000-8000-000000000000";
const TEST_SCOPE = `api://${TEST_CLIENT_ID}/codewhisperer:conversations offline_access`;
const TEST_EMAIL = "user@example.com";

function makeJwt(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `header.${encoded}.signature`;
}

describe("Kiro external_idp (CLIProxyAPI) import and refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    global.fetch = originalFetch;
  });

  afterEach(() => {
    vi.doUnmock("next/server");
    vi.doUnmock("@/models");
    vi.doUnmock("../../open-sse/utils/proxyFetch.js");
    global.fetch = originalFetch;
  });

  it("refreshes Microsoft external_idp tokens with form-encoded OAuth body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        access_token: "new-access-token",
        refresh_token: "rotated-refresh-token",
        expires_in: 3600,
      }),
    });
    global.fetch = fetchMock;

    const { refreshKiroToken } = await import("../../open-sse/services/tokenRefresh.js");
    const result = await refreshKiroToken("old-refresh-token", {
      authMethod: "external_idp",
      clientId: TEST_CLIENT_ID,
      tokenEndpoint: "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token",
      scope: TEST_SCOPE,
      profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/ABC",
      region: "us-east-1",
    });

    expect(result).toMatchObject({
      accessToken: "new-access-token",
      refreshToken: "rotated-refresh-token",
      expiresIn: 3600,
      providerSpecificData: {
        profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/ABC",
        authMethod: "external_idp",
        clientId: TEST_CLIENT_ID,
        tokenEndpoint: "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token",
        scope: TEST_SCOPE,
        region: "us-east-1",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    });
    expect(init.body).toBeInstanceOf(URLSearchParams);
    expect(Object.fromEntries(init.body.entries())).toEqual({
      grant_type: "refresh_token",
      client_id: TEST_CLIENT_ID,
      refresh_token: "old-refresh-token",
      scope: TEST_SCOPE,
    });
  });

  it("rejects external_idp refresh endpoints outside Microsoft login", async () => {
    const { refreshKiroToken } = await import("../../open-sse/services/tokenRefresh.js");
    const fetchMock = vi.fn();
    global.fetch = fetchMock;

    const result = await refreshKiroToken("old-refresh-token", {
      authMethod: "external_idp",
      clientId: "client-id",
      tokenEndpoint: "https://evil.example.com/token",
      scope: "offline_access",
    });

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("adds CodeWhisperer external IdP headers and endpoint ordering", async () => {
    const { KiroExecutor } = await import("../../open-sse/executors/kiro.js");
    const executor = new KiroExecutor();
    const credentials = {
      accessToken: "microsoft-access-token",
      providerSpecificData: { authMethod: "external_idp" },
    };

    const headers = executor.buildHeaders(credentials, true);
    expect(headers.Authorization).toBe("Bearer microsoft-access-token");
    expect(headers.TokenType).toBe("EXTERNAL_IDP");
    expect(headers.tokentype).toBeUndefined();

    expect(executor.buildUrl("claude-sonnet-4.5", true, 0, credentials)).toBe(
      "https://codewhisperer.us-east-1.amazonaws.com/generateAssistantResponse"
    );
  });

  it("sends TokenType for external_idp Kiro usage probes", async () => {
    const calls = [];
    vi.doMock("../../open-sse/utils/proxyFetch.js", () => ({
      proxyAwareFetch: vi.fn(async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          json: async () => ({
            subscriptionInfo: { subscriptionTitle: "Kiro Enterprise" },
            usageBreakdownList: [],
          }),
        };
      }),
    }));

    const { getKiroUsage } = await import("../../open-sse/services/usage/kiro.js");
    const result = await getKiroUsage("microsoft-access-token", {
      authMethod: "external_idp",
      profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/ABC",
    });

    expect(result.plan).toBe("Kiro Enterprise");
    expect(calls).toHaveLength(1);
    expect(calls[0].init.headers.Authorization).toBe("Bearer microsoft-access-token");
    expect(calls[0].init.headers.TokenType).toBe("EXTERNAL_IDP");
    expect(calls[0].init.headers.tokentype).toBeUndefined();
  });

  it("imports CLIProxyAPI external_idp JSON as a Kiro OAuth connection", async () => {
    const createdConnections = [];
    vi.doMock("next/server", () => ({
      NextResponse: {
        json(body, init = {}) {
          return new Response(JSON.stringify(body), {
            status: init.status || 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    }));
    vi.doMock("@/models", () => ({
      createProviderConnection: vi.fn(async (data) => {
        const connection = { id: "conn-1", ...data };
        createdConnections.push(connection);
        return connection;
      }),
    }));

    const { POST } = await import("../../src/app/api/oauth/kiro/import-cli-proxy/route.js");
    const accessToken = makeJwt({
      preferred_username: TEST_EMAIL,
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const cliProxyAuth = {
      type: "kiro",
      auth_method: "external_idp",
      access_token: accessToken,
      refresh_token: "1.AcY-refresh-token",
      client_id: TEST_CLIENT_ID,
      token_endpoint: "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token",
      profile_arn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/ABC",
      region: "us-east-1",
      scopes: TEST_SCOPE,
      expired: new Date(Date.now() + 3600_000).toISOString(),
    };

    const response = await POST(new Request("https://9router.local/api/oauth/kiro/import-cli-proxy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cliProxyAuth }),
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(createdConnections).toHaveLength(1);
    expect(createdConnections[0]).toMatchObject({
      provider: "kiro",
      authType: "oauth",
      accessToken,
      refreshToken: "1.AcY-refresh-token",
      email: TEST_EMAIL,
      providerSpecificData: {
        authMethod: "external_idp",
        provider: "CLIProxyAPI",
        profileArn: "arn:aws:codewhisperer:us-east-1:123456789012:profile/ABC",
        region: "us-east-1",
        clientId: TEST_CLIENT_ID,
        tokenEndpoint: "https://login.microsoftonline.com/tenant-id/oauth2/v2.0/token",
        scope: TEST_SCOPE,
      },
      testStatus: "active",
    });
  });
});
