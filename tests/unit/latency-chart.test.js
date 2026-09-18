import { describe, it, expect } from "vitest";
import { buildLatencyData } from "@/app/(dashboard)/dashboard/usage/components/latencyUtils.js";

const makeEntry = (key, p50Ttft, p95Ttft, p50Total, p95Total, count) => ({
  p50Ttft, p95Ttft, p50Total, p95Total, count, key,
});

describe("buildLatencyData", () => {
  it("filters noise below threshold", () => {
    const data = buildLatencyData({
      a: makeEntry("a", 10, 20, 30, 40, 5),
      b: makeEntry("b", 10, 20, 30, 40, 15),
    });
    expect(data.data.map((d) => d.key)).toEqual(["b"]);
    expect(data.noisy.map((d) => d.key)).toEqual(["a"]);
    expect(data.excluded).toBe(1);
  });

  it("sorts by p95Total descending", () => {
    const data = buildLatencyData({
      fast: makeEntry("fast", 10, 20, 100, 200, 20),
      slow: makeEntry("slow", 10, 20, 500, 900, 20),
    });
    expect(data.data[0].key).toBe("slow");
    expect(data.data[1].key).toBe("fast");
  });

  it("uses ttft metric for log values", () => {
    const data = buildLatencyData(
      {
        m: makeEntry("m", 50, 150, 100, 400, 20),
      },
      "ttft",
    );
    expect(data.data[0].p50Log).toBeCloseTo(Math.log10(50));
    expect(data.data[0].p95Log).toBeCloseTo(Math.log10(150));
  });

  it("computes p50Frac ratio relative to domain", () => {
    const data = buildLatencyData({
      m: makeEntry("m", 10, 100, 100, 1000, 20),
    });
    expect(data.data[0].p50Frac).toBeGreaterThanOrEqual(0);
    expect(data.data[0].p50Frac).toBeLessThanOrEqual(1);
  });

  it("handles empty input without crashing", () => {
    const data = buildLatencyData({});
    expect(data.data).toEqual([]);
    expect(data.noisy).toEqual([]);
    expect(data.domain[0]).toBeGreaterThan(0);
    expect(data.domain[1]).toBeGreaterThan(0);
  });
});
