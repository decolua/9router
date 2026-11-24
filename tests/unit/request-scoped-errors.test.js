import { beforeEach, describe, expect, it, vi } from "vitest";

// Request-scoped errors (#3875): deterministic upstream schema-validation
// rejections must not lock accounts or burn the account pool — the same body
// fails identically on every account, so the error is surfaced to the client
// instead.

const dbMocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
  getSettings: vi.fn(),
  getProxyPools: vi.fn(),
}));

vi.mock("@/lib/localDb", () => dbMocks);

const { checkFallbackError } = await import(
  "../../open-sse/services/accountFallback.js"
);
const { markAccountUnavailable } = await import(
  "../../src/sse/services/auth.js"
);

describe("checkFallbackError — request-scoped rules", () => {
  it("classifies the Anthropic schema 400 from #3875 as non-fallback", () => {
    const errorText = JSON.stringify({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "diagnostics: Extra inputs are not permitted",
      },
    });

    expect(checkFallbackError(400, errorText)).toEqual({
      shouldFallback: false,
      cooldownMs: 0,
    });
  });

  it("classifies Kiro's improperly-formed-request 400 as non-fallback", () => {
    const errorText = JSON.stringify({
      message: "Improperly formed request.",
      reason: "REQUEST_BODY_INVALID",
    });

    expect(checkFallbackError(400, errorText)).toEqual({
      shouldFallback: false,
      cooldownMs: 0,
    });
  });

  it("classifies unknown-parameter and unrecognized-argument 400s as non-fallback", () => {
    expect(
      checkFallbackError(400, "Unknown parameter: 'input[150].namespace'.")
    ).toEqual({ shouldFallback: false, cooldownMs: 0 });
    expect(
      checkFallbackError(400, "Unrecognized request argument supplied: functions")
    ).toEqual({ shouldFallback: false, cooldownMs: 0 });
  });

  it("keeps account-scoped 400s (invalid API key) on the transient cooldown path", () => {
    // A dead credential is an account-health signal: fall back to the next
    // account and cool this one down.
    const result = checkFallbackError(400, "API key not valid. Please pass a valid API key.");

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });

  it("does not touch rate-limit and auth fallback behavior", () => {
    expect(checkFallbackError(429, "rate limit exceeded").shouldFallback).toBe(true);
    expect(checkFallbackError(401, "invalid api key").cooldownMs).toBe(2 * 60 * 1000);
  });
});

describe("markAccountUnavailable — request-scoped errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getProviderConnections.mockResolvedValue([
      { id: "conn-1", displayName: "Account 1", backoffLevel: 0 },
    ]);
    dbMocks.updateProviderConnection.mockResolvedValue();
  });

  it("does not lock the account and stops the fallback loop on a request-scoped 400", async () => {
    const result = await markAccountUnavailable(
      "conn-1",
      400,
      '{"error":{"type":"invalid_request_error","message":"diagnostics: Extra inputs are not permitted"}}',
      "claude",
      "claude-opus-5"
    );

    expect(result).toEqual({ shouldFallback: false, cooldownMs: 0 });
    expect(dbMocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("still locks the account on account-scoped errors (401)", async () => {
    const result = await markAccountUnavailable(
      "conn-1",
      401,
      "Invalid API key provided",
      "claude",
      "claude-opus-5"
    );

    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBe(2 * 60 * 1000);
    expect(dbMocks.updateProviderConnection).toHaveBeenCalledTimes(1);
    const [connectionId, update] = dbMocks.updateProviderConnection.mock.calls[0];
    expect(connectionId).toBe("conn-1");
    expect(update.testStatus).toBe("unavailable");
    expect(Object.keys(update).some((k) => k.startsWith("modelLock_"))).toBe(true);
  });
});
