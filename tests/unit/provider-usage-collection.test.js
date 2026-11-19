import { beforeEach, expect, it, vi } from "vitest";
vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({ getProviderConnectionById: vi.fn(), updateProviderConnection: vi.fn() }));
vi.mock("open-sse/services/usage.js", () => ({ getUsageForProvider: vi.fn() }));
vi.mock("open-sse/services/tokenRefresh.js", () => ({ isUnrecoverableRefreshError: () => false }));
vi.mock("open-sse/executors/index.js", () => ({ getExecutor: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn() }));
import { collectProviderUsage } from "@/shared/services/providerUsage";
import { getProviderConnectionById, updateProviderConnection } from "@/lib/localDb";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { getExecutor } from "open-sse/executors/index.js";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";

const connection = { id: "a", provider: "codex", authType: "oauth", accessToken: "stale", refreshToken: "old" };
let executor;
beforeEach(() => {
  vi.clearAllMocks();
  executor = { needsRefresh: vi.fn(() => false), refreshCredentials: vi.fn(async () => ({ accessToken: "new", refreshToken: "rotated" })) };
  getExecutor.mockReturnValue(executor);
  getProviderConnectionById.mockResolvedValue({ ...connection, accessToken: "latest", refreshToken: "latest-refresh" });
  resolveConnectionProxyConfig.mockResolvedValue({ connectionProxyEnabled: true, connectionProxyUrl: "http://proxy", strictProxy: true });
  getUsageForProvider.mockResolvedValue({ quotas: { session: { resetAt: "2030-01-01" } } });
});

it("uses latest credentials and connection proxy, keeps quota fallback non-strict", async () => {
  await collectProviderUsage(connection, { force: true });
  expect(getProviderConnectionById).toHaveBeenCalledWith("a");
  expect(getUsageForProvider).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "latest" }), expect.objectContaining({
    connectionProxyEnabled: true, connectionProxyUrl: "http://proxy", strictProxy: false,
  }), { force: true });
});

it("retries auth failure once through shared refresh helper and persists rotated credentials", async () => {
  getUsageForProvider.mockResolvedValueOnce({ message: "Unauthorized 401" }).mockResolvedValueOnce({ quotas: {} });
  await collectProviderUsage(connection);
  expect(executor.refreshCredentials).toHaveBeenCalledTimes(1);
  expect(executor.refreshCredentials.mock.calls[0][0].refreshToken).toBe("latest-refresh");
  expect(updateProviderConnection).toHaveBeenCalledWith("a", expect.objectContaining({ accessToken: "new", refreshToken: "rotated" }));
  expect(getUsageForProvider).toHaveBeenCalledTimes(2);
});

it("does not refresh API-key credentials", async () => {
  await collectProviderUsage({ ...connection, authType: "apikey" });
  expect(getExecutor).not.toHaveBeenCalled();
  expect(getUsageForProvider).toHaveBeenCalledTimes(1);
});
