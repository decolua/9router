import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ connections: vi.fn(), update: vi.fn() }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.connections, updateProviderConnection: mocks.update,
  getSettings: async () => ({}), getProxyPools: async () => [], validateApiKey: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: async () => ({}), pickProxyPoolId: vi.fn() }));
vi.mock("@/shared/constants/providers.js", () => ({ FREE_PROVIDERS: {}, resolveProviderId: (id) => id === "cx" ? "codex" : id }));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));
import { markAccountUnavailable, getProviderCredentials, clearAccountError } from "../../src/sse/services/auth.js";
let account;
beforeEach(() => {
  vi.clearAllMocks();
  account = { id: "account-a", provider: "codex", isActive: true, testStatus: "active", accessToken: "fixture-token" };
  mocks.connections.mockImplementation(async () => [account]);
  mocks.update.mockImplementation(async (_id, fields) => { Object.assign(account, fields); });
});

describe("Codex model health", () => {
  it.each([
    [404, "The model `gpt-5.5` does not exist or you do not have access to it."],
    [400, "The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account."],
  ])("keeps a model access error (%s) scoped while routing other models", async (status, message) => {
    const result = await markAccountUnavailable(account.id, status, message, "codex", "gpt-5.5");
    expect(result.shouldFallback).toBe(true);
    expect(account.testStatus).toBe("active");
    expect(account.lastError).toBeUndefined();
    expect(account.lastModelError).toMatchObject({ model: "gpt-5.5", status });
    expect(await getProviderCredentials("codex", null, "gpt-5.5")).toMatchObject({ allRateLimited: true, lastErrorCode: status });
    expect(await getProviderCredentials("codex", null, "gpt-5.6-luna")).toMatchObject({ connectionId: account.id });
  });

  it("does not rotate accounts or lock models for a gateway client-version failure", async () => {
    expect(await markAccountUnavailable(account.id, 400, "This model requires a newer version of Codex.", "cx", "gpt-5.6-luna"))
      .toEqual({ shouldFallback: false, cooldownMs: 0 });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([401, 429, 502])("retains account error behavior for unrelated status %s", async (status) => {
    await markAccountUnavailable(account.id, status, "Upstream failure", "codex", "gpt-5.5");
    expect(account.testStatus).toBe("unavailable");
    expect(account.errorCode).toBe(status);
  });

  it("does not reinterpret another provider's 404", async () => {
    await markAccountUnavailable(account.id, 404, "model not found", "openai", "gpt-5.5");
    expect(account.testStatus).toBe("unavailable");
  });

  it("clears a model warning when that model succeeds but retains other active model locks", async () => {
    account.modelLock_other = new Date(Date.now() + 60000).toISOString();
    await markAccountUnavailable(account.id, 404, "model not found", "codex", "gpt-5.5");
    await clearAccountError(account.id, account, "gpt-5.5");
    expect(account.lastModelError).toBeNull();
    expect(account['modelLock_gpt-5.5']).toBeNull();
    expect(account.modelLock_other).toBeTruthy();
  });
});
