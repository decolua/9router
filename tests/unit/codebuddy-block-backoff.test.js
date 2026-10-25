import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BACKOFF_CONFIG } from "../../open-sse/config/errorConfig.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { handleComboChat } from "../../open-sse/services/combo.js";

const db = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/localDb", () => db);
vi.mock("@/lib/network/connectionProxy", () => ({
  pickProxyPoolId: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-22T00:00:00.000Z"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  db.getProviderConnections.mockResolvedValue([{ id: "cb-account", backoffLevel: 2 }]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("CodeBuddy Intl block backoff (#5024)", () => {
  it.each(["11128:request illegal", "conversation id missing"])("backs off for %s", (msg) => {
    expect(checkFallbackError(400, { code: 11128, msg }, 0, "codebuddy-intl")).toEqual({
      shouldFallback: true, cooldownMs: BACKOFF_CONFIG.base, newBackoffLevel: 1,
    });
  });

  it("increases repeated block cooldowns and respects the existing cap", () => {
    expect([0, 1, 2].map((level) =>
      checkFallbackError(400, "request illegal", level, "codebuddy-intl").cooldownMs,
    )).toEqual([BACKOFF_CONFIG.base, BACKOFF_CONFIG.base * 2, BACKOFF_CONFIG.base * 4]);
    expect(checkFallbackError(400, "request illegal", BACKOFF_CONFIG.maxLevel, "codebuddy-intl"))
      .toEqual({ shouldFallback: true, cooldownMs: BACKOFF_CONFIG.max, newBackoffLevel: BACKOFF_CONFIG.maxLevel });
  });

  it.each(["openai", "codebuddy-cn", null])("keeps the same text request-scoped for provider %s", (provider) => {
    expect(checkFallbackError(400, "request illegal", 0, provider))
      .toEqual({ shouldFallback: false, cooldownMs: 0, requestScoped: true });
  });

  it("does not classify every 11128 code as a block", () => {
    expect(checkFallbackError(400, { code: 11128, msg: "first message is not system prompt" }, 0, "codebuddy-intl"))
      .toEqual({ shouldFallback: false, cooldownMs: 0, requestScoped: true });
  });

  it("persists the account cooldown and incremented backoff level through the cbai alias", async () => {
    const result = await markAccountUnavailable("cb-account", 400, "request illegal", "cbai", "test-model");
    expect(result.shouldFallback).toBe(true);
    expect(db.updateProviderConnection).toHaveBeenCalledWith("cb-account", expect.objectContaining({
      "modelLock_test-model": new Date(Date.now() + BACKOFF_CONFIG.base * 4).toISOString(),
      backoffLevel: 3,
      errorCode: 400,
      testStatus: "unavailable",
    }));
  });

  it.each(["codebuddy-intl", "cbai"])("advances a combo after a %s block", async (provider) => {
    const backup = Response.json({ choices: [{ message: { content: "backup response" } }] });
    const dispatch = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: { message: "11128:request illegal" } }, { status: 400 }))
      .mockResolvedValueOnce(backup);
    const result = await handleComboChat({
      body: { messages: [{ role: "user", content: "Hello" }] },
      models: [`${provider}/test-model`, "openai/backup-model"],
      handleSingleModel: dispatch,
      log: { info: vi.fn(), warn: vi.fn() },
      comboName: "blocked-combo", comboStrategy: "fallback",
    });
    expect(result).toBe(backup);
    expect(dispatch.mock.calls.map(([, model]) => model)).toEqual([
      `${provider}/test-model`, "openai/backup-model",
    ]);
  });

  it("advances a combo on a malformed CodeBuddy request without locking the account", async () => {
    const error = Response.json({ error: { message: "first message is not system prompt" } }, { status: 400 });
    const backup = Response.json({ choices: [{ message: { content: "backup response" } }] });
    const dispatch = vi.fn().mockResolvedValueOnce(error).mockResolvedValueOnce(backup);
    const result = await handleComboChat({
      body: { messages: [] }, models: ["cbai/test-model", "openai/backup-model"],
      handleSingleModel: dispatch, log: { info: vi.fn(), warn: vi.fn() },
      comboName: "malformed-combo", comboStrategy: "fallback",
    });
    expect(result).toBe(backup);
    expect(dispatch.mock.calls.map(([, model]) => model)).toEqual([
      "cbai/test-model", "openai/backup-model",
    ]);
    expect(db.updateProviderConnection).not.toHaveBeenCalled();
  });
});
