import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn(), getProviderConnectionById: vi.fn(), updateProviderQuotaRoutingSnapshot: vi.fn(), updateProviderConnection: vi.fn() }));
vi.mock("open-sse/services/usage.js", () => ({ getUsageForProvider: vi.fn() }));
vi.mock("open-sse/executors/index.js", () => ({ getExecutor: vi.fn() }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: vi.fn().mockResolvedValue({}) }));

import { getSettings, getProviderConnectionById, updateProviderQuotaRoutingSnapshot } from "@/lib/localDb";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { getExecutor } from "open-sse/executors/index.js";
import { GET } from "@/app/api/usage/[connectionId]/route.js";

afterEach(() => vi.useRealTimers());

beforeEach(() => {
  vi.clearAllMocks();
  updateProviderQuotaRoutingSnapshot.mockReset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T12:00:00Z"));
  getExecutor.mockReturnValue({ needsRefresh: () => false });
  getProviderConnectionById.mockResolvedValue({ id: "a", provider: "codex", authType: "oauth", providerSpecificData: { refreshedState: "retained" } });
  getSettings.mockResolvedValue({ providerStrategies: { codex: { quotaResetFirst: true } } });
});

it("persists normalized metadata with original observation and latest unrelated data", async () => {
  const observedAtMs = Date.now() - 1000;
  getUsageForProvider.mockResolvedValue({ observedAtMs, accessToken: "must-not-save", quotas: { session: { remaining: 12, resetAt: new Date(Date.now() + 3600000).toISOString(), secret: "omit" } } });
  const response = await GET(new Request("http://localhost/api/usage/a"), { params: { connectionId: "a" } });
  expect(response.status).toBe(200);
  const [id, patch] = updateProviderQuotaRoutingSnapshot.mock.calls[0];
  expect(id).toBe("a");
  expect(patch.providerSpecificData).toBeUndefined();
  expect(patch.observedAtMs).toBe(observedAtMs);
  expect(JSON.stringify(patch)).not.toMatch(/secret|must-not-save|accessToken/);
});

it("passes request-start observations to the atomic writer despite reversed completion", async () => {
  const start = Date.now();
  const pending = [];
  const stored = { providerSpecificData: { refreshedToken: "retained" }, unrelated: true };
  updateProviderQuotaRoutingSnapshot.mockImplementation(async (id, snapshot) => {
    if (!stored.quotaRoutingSnapshot || stored.quotaRoutingSnapshot.observedAtMs < snapshot.observedAtMs) {
      stored.quotaRoutingSnapshot = snapshot;
    }
  });
  let onStarted;
  getUsageForProvider.mockImplementation(() => new Promise((resolve) => {
    pending.push(resolve);
    onStarted();
  }));
  const request = () => GET(new Request("http://localhost/api/usage/a"), { params: { connectionId: "a" } });
  let started = new Promise((resolve) => { onStarted = resolve; });
  const first = request();
  await started;
  vi.setSystemTime(start + 1000);
  started = new Promise((resolve) => { onStarted = resolve; });
  const second = request();
  await started;
  const usage = { quotas: { session: { remaining: 1, resetAt: start + 3600000 } } };
  pending[1](usage);
  await second;
  vi.setSystemTime(start + 2000);
  pending[0](usage);
  await first;
  expect(updateProviderQuotaRoutingSnapshot.mock.calls.map(([id, snapshot]) => [id, snapshot.observedAtMs])).toEqual([["a", start + 1000], ["a", start]]);
  expect(usage.observedAtMs).toBeUndefined();
  expect(stored.quotaRoutingSnapshot.observedAtMs).toBe(start + 1000);
  expect(stored.providerSpecificData).toEqual({ refreshedToken: "retained" });
  expect(stored.unrelated).toBe(true);
});

it("rejects a response delayed beyond snapshot maximum age", async () => {
  const start = Date.now();
  getUsageForProvider.mockImplementation(async () => {
    vi.setSystemTime(start + 600001);
    return { quotas: { session: { remaining: 1, resetAt: start + 3600000 } } };
  });
  expect((await GET(new Request("http://localhost/api/usage/a"), { params: { connectionId: "a" } })).status).toBe(200);
  expect(updateProviderQuotaRoutingSnapshot).not.toHaveBeenCalled();
});

it("uses the retry request start after credential refresh", async () => {
  const start = Date.now();
  getProviderConnectionById.mockResolvedValue({ id: "a", provider: "codex", authType: "oauth", refreshToken: "refresh" });
  getExecutor.mockReturnValue({ needsRefresh: () => false, refreshCredentials: async () => {
    vi.setSystemTime(start + 2000);
    return { accessToken: "new" };
  } });
  getUsageForProvider.mockResolvedValueOnce({ message: "unauthorized" }).mockImplementationOnce(async () => {
    vi.setSystemTime(start + 3000);
    return { quotas: { session: { remaining: 1, resetAt: start + 3600000 } } };
  });
  await GET(new Request("http://localhost/api/usage/a"), { params: { connectionId: "a" } });
  expect(updateProviderQuotaRoutingSnapshot).toHaveBeenCalledWith("a", expect.objectContaining({ observedAtMs: start + 2000 }));
});

it.each(["disabled", "stale", "error", "write failure"])("usage stays available on %s", async (mode) => {
  if (mode === "disabled") getSettings.mockResolvedValue({});
  const usage = { observedAtMs: Date.now() - (mode === "stale" ? 600001 : 0), quotas: { session: { remaining: 1, resetAt: Date.now() + 3600000 } }, ...(mode === "error" ? { error: "unavailable" } : {}) };
  getUsageForProvider.mockResolvedValue(usage);
  if (mode === "write failure") updateProviderQuotaRoutingSnapshot.mockRejectedValueOnce(new Error("write failed"));
  const response = await GET(new Request("http://localhost/api/usage/a"), { params: { connectionId: "a" } });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(usage);
  if (mode !== "write failure") expect(updateProviderQuotaRoutingSnapshot).not.toHaveBeenCalled();
});
