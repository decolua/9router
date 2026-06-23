import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  recordHeadroomStats,
  getHeadroomStatsSnapshot,
  currentSource,
  _resetForTest,
} from "../../open-sse/rtk/headroomStats.js";

// Mock pricing so tests are deterministic and don't depend on real model IDs
vi.mock("../../open-sse/providers/pricing.js", () => ({
  getPricingForModel: (provider, model) => {
    if (model === "gpt-4o") return { input: 2.50, output: 10.00, cached: 1.25 };
    if (model === "free-model") return { input: 0, output: 0, cached: 0 };
    return null;
  },
}));

beforeEach(() => {
  _resetForTest();
});

describe("recordHeadroomStats — counters", () => {
  it("starts at zero", () => {
    const snap = getHeadroomStatsSnapshot();
    expect(snap.summary.compression.requests_compressed).toBe(0);
    expect(snap.summary.compression.total_tokens_removed).toBe(0);
    expect(snap.summary.compression.avg_compression_pct).toBe(0);
    expect(snap.savings.total_tokens).toBe(0);
  });

  it("increments requests_compressed and total_tokens_removed", () => {
    recordHeadroomStats({ tokens_before: 100, tokens_after: 20, tokens_saved: 80, model: null, source: "custom" }, {});
    const snap = getHeadroomStatsSnapshot();
    expect(snap.summary.compression.requests_compressed).toBe(1);
    expect(snap.summary.compression.total_tokens_removed).toBe(80);
    expect(snap.savings.total_tokens).toBe(80);
  });

  it("accumulates across multiple calls", () => {
    recordHeadroomStats({ tokens_before: 100, tokens_after: 20, tokens_saved: 80, model: null, source: "custom" }, {});
    recordHeadroomStats({ tokens_before: 200, tokens_after: 100, tokens_saved: 100, model: null, source: "custom" }, {});
    const snap = getHeadroomStatsSnapshot();
    expect(snap.summary.compression.requests_compressed).toBe(2);
    expect(snap.summary.compression.total_tokens_removed).toBe(180);
  });

  it("computes rolling avg_compression_pct", () => {
    // 80% + 50% / 2 = 65%
    recordHeadroomStats({ tokens_before: 100, tokens_after: 20, tokens_saved: 80, model: null, source: "custom" }, {});
    recordHeadroomStats({ tokens_before: 200, tokens_after: 100, tokens_saved: 100, model: null, source: "custom" }, {});
    const snap = getHeadroomStatsSnapshot();
    expect(snap.summary.compression.avg_compression_pct).toBeCloseTo(65, 5);
  });

  it("ignores zero-token entries", () => {
    recordHeadroomStats({ tokens_before: 0, tokens_after: 0, tokens_saved: 0, model: null, source: "custom" }, {});
    expect(getHeadroomStatsSnapshot().summary.compression.requests_compressed).toBe(0);
  });
});

describe("recordHeadroomStats — compression_source", () => {
  it("compression_source is unavailable before any compression", () => {
    // fresh reset — no backend probed, no compression recorded
    expect(getHeadroomStatsSnapshot().compression_source).toBe("unavailable");
    expect(currentSource()).toBe("unavailable");
  });

  it("compression call with no source field falls back to custom", () => {
    recordHeadroomStats({ tokens_before: 100, tokens_after: 20, tokens_saved: 80, model: null }, {});
    expect(getHeadroomStatsSnapshot().compression_source).toBe("custom");
    expect(currentSource()).toBe("custom");
  });

  it("records detected source", () => {
    recordHeadroomStats({ tokens_before: 100, tokens_after: 20, tokens_saved: 80, model: null, source: "detected" }, {});
    expect(getHeadroomStatsSnapshot().compression_source).toBe("detected");
    expect(currentSource()).toBe("detected");
  });

  it("updates compression_source to last seen", () => {
    recordHeadroomStats({ tokens_before: 100, tokens_after: 20, tokens_saved: 80, model: null, source: "custom" }, {});
    recordHeadroomStats({ tokens_before: 50, tokens_after: 10, tokens_saved: 40, model: null, source: "detected" }, {});
    expect(getHeadroomStatsSnapshot().compression_source).toBe("detected");
  });
});

describe("recordHeadroomStats — per-project bucket", () => {
  it("creates bucket for connectionId", () => {
    recordHeadroomStats({ tokens_before: 100, tokens_after: 20, tokens_saved: 80, model: null, source: "custom" }, { connectionId: "conn-abc" });
    const snap = getHeadroomStatsSnapshot();
    expect(snap.savings.per_project["conn-abc"]).toBeDefined();
    expect(snap.savings.per_project["conn-abc"].requests).toBe(1);
    expect(snap.savings.per_project["conn-abc"].tokens_saved).toBe(80);
    expect(snap.savings.per_project["conn-abc"].last_activity_at).toBeTruthy();
  });

  it("accumulates in the same bucket", () => {
    recordHeadroomStats({ tokens_before: 100, tokens_after: 20, tokens_saved: 80, model: null, source: "custom" }, { connectionId: "conn-abc" });
    recordHeadroomStats({ tokens_before: 50, tokens_after: 10, tokens_saved: 40, model: null, source: "custom" }, { connectionId: "conn-abc" });
    const bucket = getHeadroomStatsSnapshot().savings.per_project["conn-abc"];
    expect(bucket.requests).toBe(2);
    expect(bucket.tokens_saved).toBe(120);
  });

  it("keeps separate buckets for different connections", () => {
    recordHeadroomStats({ tokens_before: 100, tokens_after: 20, tokens_saved: 80, model: null, source: "custom" }, { connectionId: "a" });
    recordHeadroomStats({ tokens_before: 50, tokens_after: 10, tokens_saved: 40, model: null, source: "custom" }, { connectionId: "b" });
    const snap = getHeadroomStatsSnapshot();
    expect(snap.savings.per_project["a"].tokens_saved).toBe(80);
    expect(snap.savings.per_project["b"].tokens_saved).toBe(40);
  });

  it("uses 'default' bucket when no connectionId", () => {
    recordHeadroomStats({ tokens_before: 100, tokens_after: 20, tokens_saved: 80, model: null, source: "custom" }, {});
    const snap = getHeadroomStatsSnapshot();
    expect(snap.savings.per_project["default"]).toBeDefined();
  });
});

describe("recordHeadroomStats — cost (mocked pricing)", () => {
  it("computes cost fields when pricing available", () => {
    // gpt-4o: input=$2.50/1M → 100 tokens before = $0.000250, 20 after = $0.000050, saved=$0.0002
    recordHeadroomStats({ tokens_before: 100, tokens_after: 20, tokens_saved: 80, model: "gpt-4o", source: "custom" }, { connectionId: "c1" });
    const snap = getHeadroomStatsSnapshot();
    const cost = snap.summary.cost;
    expect(typeof cost.without_headroom_usd).toBe("number");
    expect(typeof cost.with_headroom_usd).toBe("number");
    expect(typeof cost.total_saved_usd).toBe("number");
    expect(typeof cost.savings_pct).toBe("number");
    expect(cost.without_headroom_usd).toBeCloseTo(100 * 2.50 / 1_000_000, 10);
    expect(cost.with_headroom_usd).toBeCloseTo(20 * 2.50 / 1_000_000, 10);
    expect(cost.total_saved_usd).toBeCloseTo(80 * 2.50 / 1_000_000, 10);
    // bucket has cost too
    expect(snap.savings.per_project["c1"].compression_savings_usd).toBeCloseTo(80 * 2.50 / 1_000_000, 10);
  });

  it("returns undefined cost fields when pricing unavailable", () => {
    recordHeadroomStats({ tokens_before: 100, tokens_after: 20, tokens_saved: 80, model: "unknown-model-xyz", source: "custom" }, {});
    const cost = getHeadroomStatsSnapshot().summary.cost;
    expect(cost.without_headroom_usd).toBeUndefined();
    expect(cost.with_headroom_usd).toBeUndefined();
    expect(cost.total_saved_usd).toBeUndefined();
    expect(cost.savings_pct).toBeUndefined();
  });

  it("treats input:0 (free-model) as real pricing, not missing", () => {
    recordHeadroomStats({ tokens_before: 100, tokens_after: 20, tokens_saved: 80, model: "free-model", source: "custom" }, {});
    const cost = getHeadroomStatsSnapshot().summary.cost;
    // pricing.input === 0 → all costs are 0, but fields exist
    expect(typeof cost.without_headroom_usd).toBe("number");
    expect(cost.without_headroom_usd).toBe(0);
    expect(cost.total_saved_usd).toBe(0);
  });
});

describe("getHeadroomStatsSnapshot — shape", () => {
  it("has all required top-level keys", () => {
    const snap = getHeadroomStatsSnapshot();
    expect(snap).toHaveProperty("compression_source");
    expect(snap).toHaveProperty("uptime_seconds");
    expect(snap).toHaveProperty("summary");
    expect(snap).toHaveProperty("savings");
  });

  it("summary has compression and cost sub-objects", () => {
    const { summary } = getHeadroomStatsSnapshot();
    expect(summary).toHaveProperty("mode", "external");
    expect(summary).toHaveProperty("api_requests");
    expect(summary).toHaveProperty("primary_model");
    expect(summary.compression).toHaveProperty("requests_compressed");
    expect(summary.compression).toHaveProperty("avg_compression_pct");
    expect(summary.compression).toHaveProperty("total_tokens_removed");
    expect(summary).toHaveProperty("cost");
  });

  it("savings has total_tokens and per_project", () => {
    const { savings } = getHeadroomStatsSnapshot();
    expect(savings).toHaveProperty("total_tokens");
    expect(savings).toHaveProperty("per_project");
  });

  it("tracks primary_model as most-frequent model seen", () => {
    recordHeadroomStats({ tokens_before: 100, tokens_after: 20, tokens_saved: 80, model: "gpt-4o", source: "custom" }, {});
    recordHeadroomStats({ tokens_before: 100, tokens_after: 20, tokens_saved: 80, model: "gpt-4o", source: "custom" }, {});
    recordHeadroomStats({ tokens_before: 100, tokens_after: 20, tokens_saved: 80, model: "claude-sonnet-4", source: "custom" }, {});
    expect(getHeadroomStatsSnapshot().summary.primary_model).toBe("gpt-4o");
  });
});
