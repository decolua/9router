import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dedupRefresh } from "../../open-sse/services/tokenRefresh/dedup.js";

const source = readFileSync(fileURLToPath(new URL(
  "../../open-sse/services/tokenRefresh/dedup.js",
  import.meta.url,
)), "utf8");
const managerSource = readFileSync(fileURLToPath(new URL(
  "../../open-sse/services/oauthCredentialManager.js",
  import.meta.url,
)), "utf8");

describe("refresh result deduplication", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not cache a null refresh result", async () => {
    const refresh = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ accessToken: "fresh-token" });

    expect(await dedupRefresh("null-result", "refresh-token", refresh)).toBeNull();
    await expect(dedupRefresh("null-result", "refresh-token", refresh)).resolves.toEqual({
      accessToken: "fresh-token",
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("hashes refresh tokens and prunes all expired entries", () => {
    expect(source).toContain('createHash("sha256")');
    expect(source).toContain("pruneRefreshDedupCache");
    expect(source).not.toContain("`${provider}:${oldToken}`");
  });

  it("uses only bounded proxy-aware inner refresh deduplication", () => {
    expect(managerSource).not.toContain("refreshLocks");
    expect(managerSource).not.toContain("withCredentialRefreshLock");
    expect(source).toContain("REFRESH_DEDUP_MAX_ENTRIES");
    expect(source).toContain("refreshRouteContext(proxyOptions)");
  });

  it("expires cached refresh results", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const refresh = vi.fn()
      .mockResolvedValueOnce({ accessToken: "first-token" })
      .mockResolvedValueOnce({ accessToken: "second-token" });

    await expect(dedupRefresh("expiry-result", "expiry-token", refresh)).resolves.toEqual({
      accessToken: "first-token",
    });
    vi.setSystemTime(now + 10_001);
    await expect(dedupRefresh("expiry-result", "expiry-token", refresh)).resolves.toEqual({
      accessToken: "second-token",
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("bounds cached refresh results and retains newer entries", async () => {
    const refreshers = Array.from({ length: 257 }, (_, index) => (
      vi.fn().mockResolvedValue({ accessToken: `bounded-token-${index}` })
    ));

    for (let index = 0; index < refreshers.length; index += 1) {
      await dedupRefresh(`bounded-provider-${index}`, `bounded-refresh-${index}`, refreshers[index]);
    }

    await dedupRefresh("bounded-provider-0", "bounded-refresh-0", refreshers[0]);
    await dedupRefresh("bounded-provider-256", "bounded-refresh-256", refreshers[256]);

    expect(refreshers[0]).toHaveBeenCalledTimes(2);
    expect(refreshers[256]).toHaveBeenCalledTimes(1);
  });

  it("does not deduplicate the same token across different proxy routes", async () => {
    const directRefresh = vi.fn().mockResolvedValue({ accessToken: "direct-token" });
    const proxiedRefresh = vi.fn().mockResolvedValue({ accessToken: "proxied-token" });

    await expect(dedupRefresh(
      "proxy-context-provider",
      "shared-refresh-token",
      directRefresh,
      null,
      { disableEnvProxy: true },
    )).resolves.toEqual({ accessToken: "direct-token" });
    await expect(dedupRefresh(
      "proxy-context-provider",
      "shared-refresh-token",
      proxiedRefresh,
      null,
      {
        connectionProxyEnabled: true,
        connectionProxyUrl: "http://user:secret@proxy.test:8080",
        strictProxy: true,
      },
    )).resolves.toEqual({ accessToken: "proxied-token" });

    expect(directRefresh).toHaveBeenCalledTimes(1);
    expect(proxiedRefresh).toHaveBeenCalledTimes(1);
  });

  it("never evicts an active refresh when every cache slot is live", async () => {
    const releases = [];
    const refreshers = Array.from({ length: 256 }, (_, index) => vi.fn(() => new Promise((resolve) => {
      releases[index] = () => resolve({ accessToken: `live-token-${index}` });
    })));
    const inFlight = refreshers.map((refresh, index) => (
      dedupRefresh(`live-provider-${index}`, `live-refresh-${index}`, refresh)
    ));
    await Promise.resolve();
    expect(refreshers.every((refresh) => refresh.mock.calls.length === 1)).toBe(true);

    const overflow = vi.fn().mockResolvedValue({ accessToken: "overflow-token" });
    await expect(dedupRefresh("overflow-provider", "overflow-refresh", overflow))
      .rejects.toThrow(/capacity|retry later/i);
    expect(overflow).not.toHaveBeenCalled();

    const duplicate = vi.fn().mockResolvedValue({ accessToken: "duplicate-token" });
    const duplicateResult = dedupRefresh("live-provider-0", "live-refresh-0", duplicate);
    await Promise.resolve();
    expect(duplicate).not.toHaveBeenCalled();

    releases.forEach((release) => release());
    await expect(duplicateResult).resolves.toEqual({ accessToken: "live-token-0" });
    await Promise.all(inFlight);
    expect(refreshers[0]).toHaveBeenCalledTimes(1);
  });

  it("keeps deduplicating an active refresh regardless of elapsed time", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    let releaseOld;
    const oldRefresh = vi.fn(() => new Promise((resolve) => {
      releaseOld = () => resolve({ accessToken: "old-token" });
    }));
    const oldPromise = dedupRefresh("stale-provider", "stale-refresh", oldRefresh);
    await Promise.resolve();

    vi.setSystemTime(now + 60_001);
    const duplicateRefresh = vi.fn().mockResolvedValue({ accessToken: "duplicate-token" });
    const duplicatePromise = dedupRefresh("stale-provider", "stale-refresh", duplicateRefresh);
    await Promise.resolve();
    const duplicateCallsBeforeRelease = duplicateRefresh.mock.calls.length;
    releaseOld();

    await expect(oldPromise).resolves.toEqual({ accessToken: "old-token" });
    await expect(duplicatePromise).resolves.toEqual({ accessToken: "old-token" });
    const unexpectedRefresh = vi.fn().mockResolvedValue({ accessToken: "unexpected-token" });
    await expect(dedupRefresh("stale-provider", "stale-refresh", unexpectedRefresh)).resolves.toEqual({
      accessToken: "old-token",
    });
    expect(duplicateCallsBeforeRelease).toBe(0);
    expect(unexpectedRefresh).not.toHaveBeenCalled();
  });
});
