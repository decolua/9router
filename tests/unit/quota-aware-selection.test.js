import { describe, expect, it, vi } from "vitest";
import {
  isQuotaExhausted,
  hasExhaustedBlockingQuota,
  normalizeQuotasToSnapshot,
  sortConnectionsByRemaining,
  createQuotaSnapshotCache,
} from "../../src/sse/services/quotaAwareSelection.js";

describe("isQuotaExhausted", () => {
  it("treats remaining <= 0 as exhausted", () => {
    expect(isQuotaExhausted({ remaining: 0, total: 100 })).toBe(true);
  });
  it("treats unlimited as not exhausted", () => {
    expect(isQuotaExhausted({ unlimited: true, remaining: 0 })).toBe(false);
  });
  it("uses used/total when remaining absent", () => {
    expect(isQuotaExhausted({ used: 100, total: 100 })).toBe(true);
    expect(isQuotaExhausted({ used: 50, total: 100 })).toBe(false);
  });
});

describe("hasExhaustedBlockingQuota", () => {
  it("ignores the session key but blocks on weekly", () => {
    const quotas = {
      "session (5h)": { remaining: 0, total: 100 },
      "weekly (7d)": { remaining: 0, total: 100 },
    };
    expect(hasExhaustedBlockingQuota(quotas, "session (5h)")).toBe(true);
  });
  it("does not block when only session is exhausted", () => {
    const quotas = {
      "session (5h)": { remaining: 0, total: 100 },
      "weekly (7d)": { remaining: 40, total: 100 },
    };
    expect(hasExhaustedBlockingQuota(quotas, "session (5h)")).toBe(false);
  });
});

describe("normalizeQuotasToSnapshot", () => {
  it("prefers Claude session (5h) for remainingFraction", () => {
    const snap = normalizeQuotasToSnapshot("claude", {
      quotas: {
        "session (5h)": { remaining: 25, total: 100, remainingPercentage: 25 },
        "weekly (7d)": { remaining: 90, total: 100, remainingPercentage: 90 },
      },
    });
    expect(snap.remainingFraction).toBeCloseTo(0.25, 5);
    expect(snap.blockingExhausted).toBe(false);
  });
  it("marks blockingExhausted when weekly is empty", () => {
    const snap = normalizeQuotasToSnapshot("claude", {
      quotas: {
        "session (5h)": { remaining: 50, total: 100, remainingPercentage: 50 },
        "weekly (7d)": { remaining: 0, total: 100, remainingPercentage: 0, resetAt: "2026-09-03T12:00:00.000Z" },
      },
    });
    expect(snap.blockingExhausted).toBe(true);
    expect(snap.blockingResetAt).toBe("2026-09-03T12:00:00.000Z");
  });
  it("prefers Codex session key", () => {
    const snap = normalizeQuotasToSnapshot("codex", {
      quotas: {
        session: { remaining: 10, total: 100 },
        weekly: { remaining: 80, total: 100 },
      },
    });
    expect(snap.remainingFraction).toBeCloseTo(0.1, 5);
  });
});

describe("sortConnectionsByRemaining", () => {
  it("orders higher remainingFraction first", () => {
    const sorted = sortConnectionsByRemaining([
      { id: "low", backoffLevel: 0, lastUsedAt: "2026-09-01T00:00:00.000Z", _quotaSnapshot: { remainingFraction: 0.1 } },
      { id: "high", backoffLevel: 0, lastUsedAt: "2026-09-01T00:00:00.000Z", _quotaSnapshot: { remainingFraction: 0.9 } },
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["high", "low"]);
  });
  it("tie-breaks lower backoff then older lastUsedAt", () => {
    const sorted = sortConnectionsByRemaining([
      { id: "b", backoffLevel: 2, lastUsedAt: "2026-09-01T02:00:00.000Z", _quotaSnapshot: { remainingFraction: 0.5 } },
      { id: "a", backoffLevel: 0, lastUsedAt: "2026-09-01T01:00:00.000Z", _quotaSnapshot: { remainingFraction: 0.5 } },
    ]);
    expect(sorted[0].id).toBe("a");
  });
  it("sorts unknown snapshots after known positive remaining", () => {
    const sorted = sortConnectionsByRemaining([
      { id: "unknown", backoffLevel: 0, _quotaSnapshot: { remainingFraction: null, unknown: true } },
      { id: "known", backoffLevel: 0, _quotaSnapshot: { remainingFraction: 0.2 } },
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["known", "unknown"]);
  });
});

describe("createQuotaSnapshotCache", () => {
  it("singleflights concurrent fetches", async () => {
    let calls = 0;
    const cache = createQuotaSnapshotCache({ ttlMs: 60_000, now: () => 1_000_000 });
    const fetcher = async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 20));
      return { remainingFraction: 0.5, fetchedAt: 1_000_000 };
    };
    const [a, b] = await Promise.all([
      cache.getOrFetch("c1", fetcher),
      cache.getOrFetch("c1", fetcher),
    ]);
    expect(calls).toBe(1);
    expect(a.remainingFraction).toBe(0.5);
    expect(b.remainingFraction).toBe(0.5);
  });

  it("returns last good snapshot within staleOkMs after fetcher throws", async () => {
    let now = 1_000_000;
    const cache = createQuotaSnapshotCache({
      ttlMs: 1,
      staleOkMs: 60_000,
      now: () => now,
    });
    await cache.getOrFetch("c1", async () => ({ remainingFraction: 0.7, fetchedAt: now }));
    now = 1_000_050; // past ttl
    const snap = await cache.getOrFetch("c1", async () => {
      throw new Error("usage down");
    });
    expect(snap.remainingFraction).toBe(0.7);
    expect(snap.stale).toBe(true);
  });
});
