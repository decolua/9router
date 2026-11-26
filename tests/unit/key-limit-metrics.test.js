// Per-key spend-limit usage gauge (ninerouter.key.limit.used_ratio).
// The ratio maths (keyLimitUsage, same spend source, window and cache as checkSpendLimit)
// and the gauge callback (observeKeyLimitRatios: labels, error swallowing, throttled log).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/sse/utils/logger.js", () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }));

const svc = await import("../../src/sse/services/keySpendLimit.js");
const metrics = await import("@/lib/observability/metrics.js");

const NOW = new Date("2026-11-24T20:30:00.000Z");

function key(over = {}) {
  return {
    id: "id-a", key: "sk-a", name: "agent-a", isActive: true,
    access: { restricted: true, allow: ["gpt-4"] },
    limit: { usd: 10, window: "day" },
    ...over,
  };
}

function fakeResult() {
  const points = [];
  return { points, observe: (value, attributes) => points.push({ value, attributes }) };
}

beforeEach(() => svc.resetSpendCache());

describe("keyLimitUsage (ratio maths)", () => {
  it("day window: spend since the UTC day start divided by limit.usd", async () => {
    const getSpend = vi.fn(async () => 2.5);
    const rows = await svc.keyLimitUsage([key()], { getSpend }, NOW);
    expect(getSpend).toHaveBeenCalledWith("sk-a", "2026-11-24T00:00:00.000Z");
    expect(rows).toEqual([{ name: "agent-a", window: "day", ratio: 0.25 }]);
  });

  it("month window: spend since the UTC month start", async () => {
    const getSpend = vi.fn(async () => 45);
    const rows = await svc.keyLimitUsage([key({ limit: { usd: 50, window: "month" } })], { getSpend }, NOW);
    expect(getSpend).toHaveBeenCalledWith("sk-a", "2026-11-01T00:00:00.000Z");
    expect(rows).toEqual([{ name: "agent-a", window: "month", ratio: 0.9 }]);
  });

  it("over the limit reports a ratio above 1", async () => {
    const rows = await svc.keyLimitUsage([key()], { getSpend: async () => 10.5 }, NOW);
    expect(rows[0].ratio).toBeCloseTo(1.05, 10);
  });

  it("reports limited keys whether restricted or not (enforcement eligibility is not a filter)", async () => {
    const rows = await svc.keyLimitUsage([key({ access: { restricted: false, allow: [] } })], { getSpend: async () => 1 }, NOW);
    expect(rows).toEqual([{ name: "agent-a", window: "day", ratio: 0.1 }]);
  });

  it("skips keys without a limit and ignores a zero (or negative) limit, without reading spend", async () => {
    const getSpend = vi.fn(async () => 1);
    const rows = await svc.keyLimitUsage([
      key({ limit: null }),
      key({ limit: undefined }),
      key({ limit: { usd: 0, window: "day" } }),
      key({ limit: { usd: -1, window: "day" } }),
    ], { getSpend }, NOW);
    expect(rows).toEqual([]);
    expect(getSpend).not.toHaveBeenCalled();
  });

  it("shares the enforcement spend cache (one DB read within the TTL)", async () => {
    const getSpend = vi.fn(async () => 1);
    await svc.keyLimitUsage([key()], { getSpend }, NOW);
    await svc.checkSpendLimit(
      { endpoint: "/v1/chat/completions", limits: [{ keyValue: "sk-a", name: "agent-a", access: key().access, limit: key().limit }] },
      { getSpend, getCombos: async () => [], resolveModel: async (e) => ({ provider: "openai", model: e }), getPricing: async () => ({ input: 1 }) },
      new Date(NOW.getTime() + 1000),
    );
    expect(getSpend).toHaveBeenCalledTimes(1);
  });

  it("propagates a spend read error (the gauge callback swallows it)", async () => {
    await expect(svc.keyLimitUsage([key()], { getSpend: async () => { throw new Error("db locked"); } }, NOW)).rejects.toThrow("db locked");
  });
});

describe("observeKeyLimitRatios (gauge callback)", () => {
  let warn;
  beforeEach(async () => {
    await metrics.__resetMetricsForTests();
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("observes one point per limited key with key_name and window labels", async () => {
    const r = fakeResult();
    const keys = [
      key(),
      key({ id: "id-b", key: "sk-b", name: "agent-b", limit: { usd: 100, window: "month" } }),
      key({ id: "id-c", key: "sk-c", name: "agent-c", limit: null }),
    ];
    const spend = { "sk-a": 8, "sk-b": 95, "sk-c": 1 };
    await metrics.observeKeyLimitRatios(r, {
      getKeys: async () => keys,
      usage: (ks, now) => svc.keyLimitUsage(ks, { getSpend: async (k) => spend[k] }, now),
    }, NOW);
    expect(r.points).toEqual([
      { value: 0.8, attributes: { key_name: "agent-a", window: "day" } },
      { value: 0.95, attributes: { key_name: "agent-b", window: "month" } },
    ]);
  });

  it("labels a nameless key like the other metrics do (unknown-key), never with the key value", async () => {
    const r = fakeResult();
    await metrics.observeKeyLimitRatios(r, {
      getKeys: async () => [key({ name: "" })],
      usage: (ks, now) => svc.keyLimitUsage(ks, { getSpend: async () => 1 }, now),
    }, NOW);
    expect(r.points).toEqual([{ value: 0.1, attributes: { key_name: metrics.KEY_NAME_UNKNOWN, window: "day" } }]);
    expect(JSON.stringify(r.points)).not.toContain("sk-a");
  });

  it("swallows a DB error (no points, no throw) and logs at most once per minute", async () => {
    const failing = { getKeys: async () => { throw new Error("SQLITE_BUSY"); }, usage: async () => [] };
    const r = fakeResult();
    await expect(metrics.observeKeyLimitRatios(r, failing, NOW)).resolves.toBeUndefined();
    await metrics.observeKeyLimitRatios(r, failing, new Date(NOW.getTime() + 30_000));
    expect(r.points).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0].join(" "))).toContain("SQLITE_BUSY");
    await metrics.observeKeyLimitRatios(r, failing, new Date(NOW.getTime() + 61_000));
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("swallows a failure in the spend computation too", async () => {
    const r = fakeResult();
    await metrics.observeKeyLimitRatios(r, {
      getKeys: async () => [key()],
      usage: (ks, now) => svc.keyLimitUsage(ks, { getSpend: async () => { throw new Error("db locked"); } }, now),
    }, NOW);
    expect(r.points).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("recordKeyLimitRefused", () => {
  it("is a no-op that never throws when metrics are disabled", async () => {
    await metrics.__resetMetricsForTests();
    expect(() => metrics.recordKeyLimitRefused({ keyName: "agent-a", window: "day" })).not.toThrow();
    expect(() => metrics.recordKeyLimitRefused()).not.toThrow();
  });
});
