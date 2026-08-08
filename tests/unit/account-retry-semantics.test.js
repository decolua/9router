/**
 * Account-retry semantics for skip-rules with action:"retry".
 *
 * The original implementation served a retry rule inside BaseExecutor: it set the
 * transport attempt count to maxTransportAttempts - 1 and, once those were spent,
 * let the failure fall through to the ordinary account-fallback path -- which
 * marked the account unavailable and wrote a model-lock cooldown. So the UI
 * promise ("call the account again") was wrong twice over: the retry count was really a
 * transport setting the user never associated with the rule, and the account was
 * punished anyway.
 *
 * Correct semantics, locked here:
 *   - rule.retryAttempts = extra calls to the SAME account, owned by the
 *     account-selection layer in chat.js, counted per request.
 *   - Exhausting it moves to the next account with NO DB write at all: no
 *     unavailable status, no model lock, no backoff, no lastError.
 *   - It is independent of maxTransportAttempts in both directions.
 *   - A client abort stops retrying immediately.
 *   - Skip rules and unmatched errors keep their existing behaviour.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getRoutingMeta } from "../../open-sse/services/routingMeta.js";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  getComboModels: vi.fn(),
  getModelInfo: vi.fn(),
  handleChatCore: vi.fn(),
}));

// The real chat.js account loop and the real auth.js run; only DB deps are stubbed.
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
  validateApiKey: vi.fn(),
  getProxyPools: vi.fn(async () => []),
}));
vi.mock("../../src/sse/services/model.js", () => ({
  getComboModels: mocks.getComboModels,
  getModelInfo: mocks.getModelInfo,
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_p, c) => c),
  updateProviderCredentials: vi.fn(),
}));
vi.mock("../../open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));
vi.mock("../../open-sse/services/projectId.js", () => ({ getProjectIdForConnection: vi.fn() }));

function makeRequest(model) {
  return new Request("http://localhost/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }] }),
  });
}

const fail502 = () => ({
  success: false, status: 502, error: "[502]: upstream busy", errorKind: "http_502",
  response: new Response("err", { status: 502 }),
});
const ok = () => ({ success: true, response: new Response("ok", { status: 200 }) });

// Which connection each handleChatCore call ran against, in order.
const calledConnections = () => mocks.handleChatCore.mock.calls.map(c => c[0].connectionId);

function settings(rules, maxTransportAttempts = 2) {
  mocks.getSettings.mockResolvedValue({
    requireApiKey: false,
    providerSkipRules: rules,
    maxTransportAttempts,
  });
}

const RETRY_RULE = (extra) => ({
  provider: "kr-ac", match: { status: 502 }, action: "retry",
  ...(extra != null ? { retryAttempts: extra } : {}),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getComboModels.mockResolvedValue(null);
  mocks.getModelInfo.mockResolvedValue({ provider: "kr-ac", model: "m1" });
});

describe("account retry calls the same account retryAttempts extra times", () => {
  it("retryAttempts:3 → 4 calls on the same connection before moving on", async () => {
    settings([RETRY_RULE(3)]);
    mocks.getProviderConnections.mockResolvedValue([
      { id: "kr-1", provider: "kr-ac", isActive: true, backoffLevel: 0 },
    ]);
    mocks.handleChatCore.mockResolvedValue(fail502());

    const { handleChat } = await import("../../src/sse/handlers/chat.js");
    await handleChat(makeRequest("kr-ac/m1"));

    // 1 initial + 3 retries, all on kr-1; then the pool is exhausted.
    expect(calledConnections()).toEqual(["kr-1", "kr-1", "kr-1", "kr-1"]);
  });

  it("does not move to the next account until the budget is spent", async () => {
    settings([RETRY_RULE(2)]);
    mocks.getProviderConnections.mockResolvedValue([
      { id: "kr-1", provider: "kr-ac", isActive: true, priority: 1, backoffLevel: 0 },
      { id: "kr-2", provider: "kr-ac", isActive: true, priority: 2, backoffLevel: 0 },
    ]);
    mocks.handleChatCore.mockResolvedValue(fail502());

    const { handleChat } = await import("../../src/sse/handlers/chat.js");
    await handleChat(makeRequest("kr-ac/m1"));

    // kr-1 three times (1 + 2), then kr-2 three times, then exhausted.
    expect(calledConnections()).toEqual(["kr-1", "kr-1", "kr-1", "kr-2", "kr-2", "kr-2"]);
  });

  it("honours a budget far above any built-in ceiling", async () => {
    // The user decides how many retries they want; there is no upper bound. 25 is
    // chosen only because it is comfortably past the 10 that used to be enforced,
    // and a value over that ceiling used to collapse to 1 extra call in silence.
    settings([RETRY_RULE(25)]);
    mocks.getProviderConnections.mockResolvedValue([
      { id: "kr-1", provider: "kr-ac", isActive: true, backoffLevel: 0 },
    ]);
    mocks.handleChatCore.mockResolvedValue(fail502());

    const { handleChat } = await import("../../src/sse/handlers/chat.js");
    await handleChat(makeRequest("kr-ac/m1"));

    expect(calledConnections()).toEqual(Array(26).fill("kr-1"));
  });

  it("a retry rule with no retryAttempts defaults to one extra call", async () => {
    // Backward compatibility for rules saved before the field existed.
    settings([RETRY_RULE(null)]);
    mocks.getProviderConnections.mockResolvedValue([
      { id: "kr-1", provider: "kr-ac", isActive: true, backoffLevel: 0 },
    ]);
    mocks.handleChatCore.mockResolvedValue(fail502());

    const { handleChat } = await import("../../src/sse/handlers/chat.js");
    await handleChat(makeRequest("kr-ac/m1"));

    expect(calledConnections()).toEqual(["kr-1", "kr-1"]);
  });
});

describe("a retry that succeeds stops immediately", () => {
  it("returns the success and never touches the next account", async () => {
    settings([RETRY_RULE(3)]);
    mocks.getProviderConnections.mockResolvedValue([
      { id: "kr-1", provider: "kr-ac", isActive: true, priority: 1, backoffLevel: 0 },
      { id: "kr-2", provider: "kr-ac", isActive: true, priority: 2, backoffLevel: 0 },
    ]);
    mocks.handleChatCore
      .mockResolvedValueOnce(fail502())
      .mockResolvedValueOnce(fail502())
      .mockResolvedValueOnce(ok());

    const { handleChat } = await import("../../src/sse/handlers/chat.js");
    const resp = await handleChat(makeRequest("kr-ac/m1"));

    expect(resp.status).toBe(200);
    expect(calledConnections()).toEqual(["kr-1", "kr-1", "kr-1"]);
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });
});

describe("account retry never writes account state", () => {
  it("writes no cooldown, lock, backoff or lastError even after the budget is spent", async () => {
    settings([RETRY_RULE(2)]);
    mocks.getProviderConnections.mockResolvedValue([
      { id: "kr-1", provider: "kr-ac", isActive: true, priority: 1, backoffLevel: 0 },
      { id: "kr-2", provider: "kr-ac", isActive: true, priority: 2, backoffLevel: 0 },
    ]);
    mocks.handleChatCore.mockResolvedValue(fail502());

    const { handleChat } = await import("../../src/sse/handlers/chat.js");
    await handleChat(makeRequest("kr-ac/m1"));

    // The whole point: the account is not what failed, so nothing is persisted.
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("an unmatched error still cools the account down (unchanged behaviour)", async () => {
    settings([RETRY_RULE(2)]); // rule matches 502 only
    mocks.getProviderConnections.mockResolvedValue([
      { id: "kr-1", provider: "kr-ac", isActive: true, backoffLevel: 0 },
    ]);
    mocks.handleChatCore.mockResolvedValue({
      success: false, status: 500, error: "boom", errorKind: "http_500",
      response: new Response("err", { status: 500 }),
    });

    const { handleChat } = await import("../../src/sse/handlers/chat.js");
    await handleChat(makeRequest("kr-ac/m1"));

    expect(mocks.updateProviderConnection).toHaveBeenCalledWith(
      "kr-1",
      expect.objectContaining({ testStatus: "unavailable" })
    );
  });
});

describe("account retry is independent of maxTransportAttempts", () => {
  it.each([1, 5])("maxTransportAttempts=%i does not change the account retry count", async (maxTransportAttempts) => {
    settings([RETRY_RULE(3)], maxTransportAttempts);
    mocks.getProviderConnections.mockResolvedValue([
      { id: "kr-1", provider: "kr-ac", isActive: true, backoffLevel: 0 },
    ]);
    mocks.handleChatCore.mockResolvedValue(fail502());

    const { handleChat } = await import("../../src/sse/handlers/chat.js");
    await handleChat(makeRequest("kr-ac/m1"));

    expect(calledConnections()).toEqual(["kr-1", "kr-1", "kr-1", "kr-1"]);
  });
});

describe("skip rules are unaffected", () => {
  it("skip moves on after one call and writes no cooldown", async () => {
    settings([{ provider: "kr-ac", match: { status: 502 }, action: "skip" }]);
    mocks.getProviderConnections.mockResolvedValue([
      { id: "kr-1", provider: "kr-ac", isActive: true, priority: 1, backoffLevel: 0 },
      { id: "kr-2", provider: "kr-ac", isActive: true, priority: 2, backoffLevel: 0 },
    ]);
    mocks.handleChatCore.mockResolvedValue(fail502());

    const { handleChat } = await import("../../src/sse/handlers/chat.js");
    await handleChat(makeRequest("kr-ac/m1"));

    expect(calledConnections()).toEqual(["kr-1", "kr-2"]);
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });
});

describe("client abort stops the retry loop", () => {
  it("returns the aborted response instead of consuming budget", async () => {
    settings([{ provider: "kr-ac", match: { status: 499 }, action: "retry", retryAttempts: 5 }]);
    mocks.getProviderConnections.mockResolvedValue([
      { id: "kr-1", provider: "kr-ac", isActive: true, backoffLevel: 0 },
    ]);
    mocks.handleChatCore.mockResolvedValue({
      success: false, status: 499, error: "Request aborted", errorKind: "aborted",
      response: new Response("aborted", { status: 499 }),
    });

    const { handleChat } = await import("../../src/sse/handlers/chat.js");
    const resp = await handleChat(makeRequest("kr-ac/m1"));

    expect(resp.status).toBe(499);
    expect(calledConnections()).toEqual(["kr-1"]); // no retry after an abort
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });
});

describe("no-auth providers retry the virtual connection without looping", () => {
  it("retries retryAttempts times then terminates", async () => {
    mocks.getModelInfo.mockResolvedValue({ provider: "mimo-free", model: "mimo-auto" });
    mocks.getSettings.mockResolvedValue({
      requireApiKey: false,
      providerSkipRules: [{ provider: "mimo-free", match: { status: 502 }, action: "retry", retryAttempts: 2 }],
      maxTransportAttempts: 2,
    });
    mocks.getProviderConnections.mockResolvedValue([]); // unused on the noAuth path
    mocks.handleChatCore.mockResolvedValue(fail502());

    const { handleChat } = await import("../../src/sse/handlers/chat.js");
    const resp = await handleChat(makeRequest("mimo-free/mimo-auto"));

    // 1 + 2 retries against the single virtual connection, then a terminal return
    // rather than an endless re-select of the same virtual account.
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(3);
    expect(resp.status).toBe(502);
    expect(getRoutingMeta(resp)?.failFast).toBe(true);
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });
});
