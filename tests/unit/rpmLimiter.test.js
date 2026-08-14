import { describe, it, expect, beforeEach } from "vitest";
import { isOverLimit, recordRequest, retryAfterMs, usage, _reset } from "@/sse/services/rpmLimiter.js";

describe("rpmLimiter", () => {
  beforeEach(() => _reset());

  it("treats 0 / unset as unlimited", () => {
    const t = 1_000_000;
    for (let i = 0; i < 100; i += 1) recordRequest("a", t);
    expect(isOverLimit("a", 0, t)).toBe(false);
    expect(isOverLimit("a", undefined, t)).toBe(false);
  });

  it("caps at the limit and frees up as the window slides", () => {
    const t = 1_000_000;
    for (let i = 0; i < 40; i += 1) recordRequest("a", t + i); // 40 within the minute
    expect(usage("a", t + 40)).toBe(40);
    expect(isOverLimit("a", 40, t + 40)).toBe(true);

    // still capped just before the oldest request ages out
    expect(isOverLimit("a", 40, t + 59_999)).toBe(true);
    // oldest has aged out -> capacity again
    expect(isOverLimit("a", 40, t + 60_001)).toBe(false);
  });

  it("counts each account separately", () => {
    const t = 1_000_000;
    for (let i = 0; i < 40; i += 1) recordRequest("a", t);
    expect(isOverLimit("a", 40, t)).toBe(true);
    expect(isOverLimit("b", 40, t)).toBe(false);
  });

  it("reports when capacity returns", () => {
    const t = 1_000_000;
    for (let i = 0; i < 40; i += 1) recordRequest("a", t);
    expect(retryAfterMs("a", 40, t + 10_000)).toBe(50_000);
    expect(retryAfterMs("b", 40, t + 10_000)).toBeNull();
  });
});
