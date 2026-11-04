import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/localDb", () => dbMocks);
vi.mock("@/lib/network/connectionProxy", () => ({
  pickProxyPoolId: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");

function setConnection(overrides = {}) {
  dbMocks.getProviderConnections.mockResolvedValue([{
    id: "conn-a",
    provider: "claude",
    authType: "oauth",
    name: "conn-a",
    backoffLevel: 3,
    ...overrides,
  }]);
}

async function fail({
  provider = "claude",
  authType = "oauth",
  status = 401,
  text = "Unauthorized",
  model = "model-a",
} = {}) {
  setConnection({ provider, authType });
  await markAccountUnavailable("conn-a", status, text, provider, model);
}

function reauthPatch() {
  return dbMocks.updateProviderConnection.mock.calls
    .find(([, patch]) => patch.testStatus === "reauth_required")?.[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  setConnection();
});

describe("provider re-authentication quarantine", () => {
  it.each([
    ["codex", "oauth", 401, "Encountered invalidated oauth token for user"],
    ["claude", "oauth", 401, "OAuth token has expired"],
    ["antigravity", "oauth", 401, '{"error":"invalid_grant"}'],
    ["gemini-cli", "oauth", 401, "Request had invalid authentication credentials"],
    ["github", "oauth", 401, "Bad credentials"],
    ["qoder", "oauth", 401, "qoder credential is missing accessToken; reconnect the account"],
    ["codebuddy-cn", "oauth", 401, "Unauthorized"],
    ["openai-compatible-x", "apikey", 401, "Incorrect API key provided"],
    ["openai-compatible-y", "api_key", 401, "Invalid API key"],
    ["openai-compatible-z", "apikey", 400, "API key not valid. Please pass a valid API key."],
    ["openai-compatible-t", "access_token", 401, "Unauthorized"],
  ])("quarantines %s (%s) on %i: %s", async (provider, authType, status, text) => {
    await fail({ provider, authType, status, text });

    const patch = reauthPatch();
    expect(patch).toBeTruthy();
    expect(patch).toMatchObject({
      isActive: false,
      testStatus: "reauth_required",
      errorCode: status,
      backoffLevel: 0,
    });
    expect(patch).not.toHaveProperty("modelLock_model-a");
  });

  it("quarantines an OAuth 403 when the body names a dead grant", async () => {
    await fail({
      provider: "kiro",
      authType: "oauth",
      status: 403,
      text: "invalid_grant: the security token included in the request is invalid",
    });

    expect(reauthPatch()).toMatchObject({ testStatus: "reauth_required" });
  });

  it.each([
    ["openai-compatible-x", "apikey", 401, "Unauthorized"],
    ["openai-compatible-y", "apikey", 403, "Permission denied"],
    ["claude", "oauth", 403, "Permission denied"],
    ["cookie-provider", "cookie", 401, "session expired"],
  ])("leaves %s (%s) on the normal cooldown path for %i: %s", async (provider, authType, status, text) => {
    await fail({ provider, authType, status, text });

    expect(reauthPatch()).toBeUndefined();
  });
});
