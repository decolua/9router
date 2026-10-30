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

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getProviderConnections.mockResolvedValue([{
    id: "codex-a",
    provider: "codex",
    name: "codex-a",
    backoffLevel: 3,
  }]);
});

describe("Codex re-authentication quarantine", () => {
  it("disables the profile when the OAuth token was invalidated", async () => {
    const result = await markAccountUnavailable(
      "codex-a",
      401,
      "Encountered invalidated oauth token for user, failing request",
      "codex",
      "gpt-5.6-sol",
    );

    expect(result).toEqual({ shouldFallback: true, cooldownMs: 0 });
    expect(dbMocks.updateProviderConnection).toHaveBeenCalledWith(
      "codex-a",
      expect.objectContaining({
        isActive: false,
        testStatus: "reauth_required",
        errorCode: 401,
        backoffLevel: 0,
      }),
    );
    expect(dbMocks.updateProviderConnection.mock.calls[0][1])
      .not.toHaveProperty("modelLock_gpt-5.6-sol");
  });

  it("detects the token_expired payload from the OAuth endpoint", async () => {
    await markAccountUnavailable(
      "codex-a",
      401,
      '{"error":{"message":"Could not validate your token. Please try signing in again.","type":"invalid_request_error","code":"token_expired"}}',
      "codex",
      "gpt-5.6-sol",
    );

    expect(dbMocks.updateProviderConnection).toHaveBeenCalledWith(
      "codex-a",
      expect.objectContaining({
        isActive: false,
        testStatus: "reauth_required",
      }),
    );
  });

  it("recognizes alternate invalidated-token wording", async () => {
    await markAccountUnavailable(
      "codex-a",
      401,
      "Your authentication token has been invalidated. Please try signing in again.",
      "codex",
      "gpt-5.6-sol",
    );

    expect(dbMocks.updateProviderConnection).toHaveBeenCalledWith(
      "codex-a",
      expect.objectContaining({ testStatus: "reauth_required" }),
    );
  });

  it("leaves ordinary 401s on the normal cooldown path", async () => {
    await markAccountUnavailable(
      "codex-a",
      401,
      "Unauthorized",
      "codex",
      "gpt-5.6-sol",
    );

    const reauthWrites = dbMocks.updateProviderConnection.mock.calls
      .filter(([, patch]) => patch.testStatus === "reauth_required");
    expect(reauthWrites).toHaveLength(0);
  });

  it("does not quarantine other providers", async () => {
    await markAccountUnavailable(
      "codex-a",
      401,
      "Encountered invalidated oauth token for user, failing request",
      "claude",
      "claude-sonnet-4-6",
    );

    const reauthWrites = dbMocks.updateProviderConnection.mock.calls
      .filter(([, patch]) => patch.testStatus === "reauth_required");
    expect(reauthWrites).toHaveLength(0);
  });
});
