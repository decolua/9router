import { describe, it, expect, beforeEach } from "vitest";
import { getOrResolvePersistent, __clearHeaderCache } from "open-sse/utils/headerCache.js";

beforeEach(() => __clearHeaderCache());

describe("getOrResolvePersistent", () => {
  it("miss → calls resolveFn, stores, returns fresh value", () => {
    let n = 0;
    const v = getOrResolvePersistent("k1", 5, () => `v${++n}`, 1000);
    expect(v).toBe("v1");
    expect(n).toBe(1);
  });

  it("fresh hit → returns cached value, resolveFn NOT called again", () => {
    let n = 0;
    getOrResolvePersistent("k1", 5, () => `v${++n}`, 1000);
    const v2 = getOrResolvePersistent("k1", 5, () => `v${++n}`, 1000 + 4 * 60000);
    expect(v2).toBe("v1");
    expect(n).toBe(1);
  });

  it("timed expiry → regenerates after ttl passes", () => {
    let n = 0;
    getOrResolvePersistent("k1", 5, () => `v${++n}`, 1000);
    // 5 min = 300000ms; now well past expiry
    const v2 = getOrResolvePersistent("k1", 5, () => `v${++n}`, 1000 + 6 * 60000);
    expect(v2).toBe("v2");
    expect(n).toBe(2);
  });

  it("permanent (ttlMinutes 0) never expires", () => {
    let n = 0;
    getOrResolvePersistent("k1", 0, () => `v${++n}`, 1000);
    const v2 = getOrResolvePersistent("k1", 0, () => `v${++n}`, 1000 + 10 * 365 * 24 * 60 * 60000);
    expect(v2).toBe("v1");
    expect(n).toBe(1);
  });

  it("different key → independent entry", () => {
    getOrResolvePersistent("a", 0, () => "A", 1000);
    const b = getOrResolvePersistent("b", 0, () => "B", 1000);
    expect(b).toBe("B");
  });

  it("__clearHeaderCache resets", () => {
    let n = 0;
    getOrResolvePersistent("k1", 0, () => `v${++n}`, 1000);
    __clearHeaderCache();
    const v2 = getOrResolvePersistent("k1", 0, () => `v${++n}`, 1000);
    expect(v2).toBe("v2");
  });

  it("size cap evicts oldest beyond limit (no unbounded growth)", () => {
    // Insert cap+10 distinct permanent keys; map must not exceed the cap.
    for (let i = 0; i < 5010; i++) {
      getOrResolvePersistent(`key${i}`, 0, () => `v${i}`, 1000);
    }
    // The earliest keys should have been evicted; a fresh resolve for key0
    // therefore calls resolveFn again (returns the NEW value).
    const again = getOrResolvePersistent("key0", 0, () => "NEW", 1000);
    expect(again).toBe("NEW");
  });
});
