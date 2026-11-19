import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({ getProviderConnections: vi.fn() }));
vi.mock("@/shared/services/providerUsage", () => ({ collectProviderUsage: vi.fn() }));
import { getProviderConnections } from "@/lib/localDb";
import { collectProviderUsage } from "@/shared/services/providerUsage";

let quota;
const connection = (id, provider = "claude") => ({ id, provider, authType: "oauth" });
const settings = (strategy = "weekly-reset-earliest") => ({ providerStrategies: { claude: { strategy } } });
const usage = { quotas: { "weekly (7d)": { resetAt: "2030-01-01T00:00:00Z", used: 5 } } };
async function tick(ms = 0) {
  await vi.advanceTimersByTimeAsync(ms);
  await vi.dynamicImportSettled();
}

beforeEach(async () => {
  vi.resetModules();
  delete globalThis.__accountQuotaWindows;
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-19T03:00:00Z"));
  vi.mocked(getProviderConnections).mockReset().mockResolvedValue([connection("a")]);
  vi.mocked(collectProviderUsage).mockReset().mockResolvedValue(usage);
  quota = await import("@/shared/services/accountQuotaWindows");
});
afterEach(() => {
  quota.configureAccountQuotaWindows({});
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("account quota windows real cache/scheduler", () => {
  it("starts without dashboard, defers all I/O outside caller and deduplicates", async () => {
    quota.configureAccountQuotaWindows(settings());
    for (let i = 0; i < 10; i++) expect(quota.ensureProviderQuotaWindows("claude")).toBeUndefined();
    expect(getProviderConnections).not.toHaveBeenCalled();
    expect(quota.getAccountQuotaSnapshot("a")).toBeNull();
    await tick();
    expect(collectProviderUsage).toHaveBeenCalledTimes(1);
    expect(quota.getAccountQuotaSnapshot("a").quotas).toEqual(usage.quotas);
    await tick(60_001);
    expect(collectProviderUsage).toHaveBeenCalledTimes(2);
  });

  it("does not poll manual, unsupported providers, inactive or non-OAuth accounts", async () => {
    quota.configureAccountQuotaWindows(settings("fill-first"));
    quota.ensureProviderQuotaWindows("claude");
    await tick(120_000);
    expect(getProviderConnections).not.toHaveBeenCalled();
    getProviderConnections.mockResolvedValue([{ ...connection("key"), authType: "apikey" }]);
    quota.configureAccountQuotaWindows(settings());
    await tick();
    expect(collectProviderUsage).not.toHaveBeenCalled();
    expect(getProviderConnections).toHaveBeenCalledWith({ provider: "claude", isActive: true });
    quota.configureAccountQuotaWindows({ providerStrategies: { antigravity: { strategy: "weekly-reset-earliest" } } });
    await tick(120_000);
    expect(collectProviderUsage).not.toHaveBeenCalled();
  });

  it("bounds concurrency globally and deduplicates in-flight accounts", async () => {
    getProviderConnections.mockResolvedValue(Array.from({ length: 5 }, (_, i) => connection(String(i))));
    const finish = [];
    collectProviderUsage.mockImplementation(() => new Promise((resolve) => finish.push(resolve)));
    quota.configureAccountQuotaWindows(settings());
    await tick(1);
    expect(collectProviderUsage).toHaveBeenCalledTimes(2);
    await tick(60_001);
    expect(collectProviderUsage).toHaveBeenCalledTimes(2);
    finish[0](usage);
    await tick();
    expect(collectProviderUsage).toHaveBeenCalledTimes(3);
    quota.configureAccountQuotaWindows({});
    finish.slice(1).forEach((resolve) => resolve(usage));
    await tick();
    expect(collectProviderUsage).toHaveBeenCalledTimes(3);
  });

  it("backs off errors/429 and expires old snapshots rather than inventing windows", async () => {
    quota.recordAccountQuotaSnapshot("a", usage, "claude");
    collectProviderUsage.mockRejectedValue(new Error("429"));
    quota.configureAccountQuotaWindows(settings());
    await tick(60_001);
    expect(collectProviderUsage).toHaveBeenCalledTimes(1);
    await tick(60_000);
    expect(collectProviderUsage).toHaveBeenCalledTimes(2);
    await tick(60_000);
    expect(collectProviderUsage).toHaveBeenCalledTimes(2);
    await tick(120_000);
    expect(quota.getAccountQuotaSnapshot("a")).toBeNull();
    expect(collectProviderUsage).toHaveBeenCalledTimes(3);
  });

  it("exposes only connection IDs, timestamps and allowlisted quota fields", async () => {
    quota.recordAccountQuotaSnapshot("a", {
      accessToken: "secret", email: "private", quotas: {
        session: { resetAt: "2000-01-01", used: 2, accessToken: "secret", nested: { password: "secret" } },
      },
    }, "claude");
    const { snapshots } = await quota.getProviderQuotaWindows("claude");
    expect(snapshots.a.quotas.session).toEqual({ resetAt: "2000-01-01", used: 2 });
    expect(JSON.stringify(snapshots)).not.toContain("secret");
    expect(snapshots.a.fetchedAt).toBe(Date.now());
    expect(Object.isFrozen(snapshots.a.quotas.session)).toBe(true);
    getProviderConnections.mockResolvedValue([]);
    expect((await quota.getProviderQuotaWindows("claude")).snapshots).toEqual({});
  });

  it("validates endpoint provider IDs and prevents response caching", async () => {
    const { GET } = await import("@/app/api/provider-quota-windows/route");
    expect((await GET(new Request("http://localhost/api/provider-quota-windows?provider=unknown"))).status).toBe(400);
    const response = await GET(new Request("http://localhost/api/provider-quota-windows?provider=claude"));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({ snapshots: {}, refreshing: false });
  });
});
