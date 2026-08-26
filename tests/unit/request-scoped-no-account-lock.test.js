// The lock that `markAccountUnavailable` writes is read by every concurrent
// caller — `probeAccountCapacity` consults it before the combo cascade passes
// over an entry — so the question "did we write a lock" is really "did we
// withdraw this model from other sessions". The classifier test next door proves
// the verdict; this one proves the write, because the two can disagree and the
// symptom of disagreeing is invisible from the outside: a healthy account, no
// error in its row, and a combo that keeps reporting exhaustion.
//
// Incident this guards, 2026-08-26: one session (558 messages, 119 tool
// definitions) drew repeated opaque 400s from openrouter's Stealth upstream.
// Each 400 locked both OpenRouter accounts for two minutes, so ox-alpha — the
// head of Yggdrasil, answering other sessions that same minute — was skipped as
// "no account has capacity for it right now", and the client was told its keys
// were exhausted by a 429 that came from a different provider entirely.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
  getSettings: vi.fn(async () => ({})),
  getProxyPools: vi.fn(async () => []),
}));

vi.mock("@/lib/localDb", () => mocks);

vi.mock("../../src/sse/utils/logger.js", () => ({
  info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(), request: vi.fn(),
  maskKey: (k) => k,
}));

const CONN = { id: "conn-1", provider: "openrouter", name: "inyund", backoffLevel: 0 };

// Verbatim from the router log of the incident above.
const STEALTH_400 =
  '{"error":{"message":"Provider returned error","code":400,' +
  '"metadata":{"raw":"ERROR","provider_name":"Stealth","is_byok":false}}}';

let markAccountUnavailable;

beforeEach(async () => {
  vi.clearAllMocks();
  mocks.getProviderConnections.mockResolvedValue([CONN]);
  mocks.updateProviderConnection.mockResolvedValue(undefined);
  ({ markAccountUnavailable } = await import("../../src/sse/services/auth.js"));
});

describe("a request-scoped failure must not withdraw the model from other sessions", () => {
  it("writes nothing to the connection for an upstream 400", async () => {
    const result = await markAccountUnavailable(
      "conn-1", 400, STEALTH_400, "openrouter", "stealth/ox-alpha"
    );

    expect(result.shouldFallback).toBe(true);
    expect(result.requestScoped).toBe(true);
    expect(result.cooldownMs).toBe(0);
    // The whole point: no lock, and no downgrade of the account's health either.
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("still falls back, so this request is not stranded on the failing entry", async () => {
    const { shouldFallback } = await markAccountUnavailable(
      "conn-1", 400, STEALTH_400, "openrouter", "stealth/ox-alpha"
    );
    expect(shouldFallback).toBe(true);
  });
});

describe("supply failures still lock, or the fix would trade one blindness for another", () => {
  it("429 locks the model on the account and marks it unavailable", async () => {
    const result = await markAccountUnavailable(
      "conn-1", 429, "Rate limit exceeded", "openrouter", "stealth/ox-alpha"
    );

    expect(result.requestScoped).toBeUndefined();
    expect(result.cooldownMs).toBeGreaterThan(0);
    expect(mocks.updateProviderConnection).toHaveBeenCalledTimes(1);
    const [, update] = mocks.updateProviderConnection.mock.calls[0];
    expect(update["modelLock_stealth/ox-alpha"]).toBeTruthy();
    expect(update.testStatus).toBe("unavailable");
  });

  it("403 locks and marks the account expired, not merely busy", async () => {
    await markAccountUnavailable("conn-1", 403, "Forbidden", "openrouter", "m");
    const [, update] = mocks.updateProviderConnection.mock.calls[0];
    expect(update.testStatus).toBe("expired");
  });

  it("a 400 carrying malformed model output still locks — that one is the account's fault", async () => {
    const result = await markAccountUnavailable(
      "conn-1", 400, "Malformed model output: doubled-json", "oc", "mimo-v2.5-free"
    );

    expect(result.requestScoped).toBeUndefined();
    expect(mocks.updateProviderConnection).toHaveBeenCalledTimes(1);
    expect(mocks.updateProviderConnection.mock.calls[0][1]["modelLock_mimo-v2.5-free"]).toBeTruthy();
  });

  it("a 400 naming a billing failure still locks — waiting does not buy credits", async () => {
    const result = await markAccountUnavailable(
      "conn-1", 400, '{"message":"You have insufficient credits"}', "commandcode", "deepseek/deepseek-v4-pro"
    );

    expect(result.requestScoped).toBeUndefined();
    expect(mocks.updateProviderConnection).toHaveBeenCalledTimes(1);
  });
});
