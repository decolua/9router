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
  afterEach(() => vi.restoreAllMocks());

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
    const now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const refresh = vi.fn()
      .mockResolvedValueOnce({ accessToken: "first-token" })
      .mockResolvedValueOnce({ accessToken: "second-token" });

    await expect(dedupRefresh("expiry-result", "expiry-token", refresh)).resolves.toEqual({
      accessToken: "first-token",
    });
    vi.mocked(Date.now).mockReturnValue(now + 10_001);
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

  it("replaces stale in-flight refresh without letting it overwrite newer result", async () => {
    const now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    let releaseOld;
    const oldRefresh = vi.fn(() => new Promise((resolve) => {
      releaseOld = () => resolve({ accessToken: "old-token" });
    }));
    const oldPromise = dedupRefresh("stale-provider", "stale-refresh", oldRefresh);
    await Promise.resolve();

    vi.mocked(Date.now).mockReturnValue(now + 60_001);
    const newRefresh = vi.fn().mockResolvedValue({ accessToken: "new-token" });
    const newPromise = dedupRefresh("stale-provider", "stale-refresh", newRefresh);
    await Promise.resolve();
    const newCallsBeforeRelease = newRefresh.mock.calls.length;
    releaseOld();

    await expect(oldPromise).resolves.toEqual({ accessToken: "old-token" });
    await expect(newPromise).resolves.toEqual({ accessToken: "new-token" });
    const unexpectedRefresh = vi.fn().mockResolvedValue({ accessToken: "unexpected-token" });
    await expect(dedupRefresh("stale-provider", "stale-refresh", unexpectedRefresh)).resolves.toEqual({
      accessToken: "new-token",
    });
    expect(newCallsBeforeRelease).toBe(1);
    expect(unexpectedRefresh).not.toHaveBeenCalled();
  });
});
