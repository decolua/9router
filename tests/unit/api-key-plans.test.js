import { describe, it, expect } from "vitest";
import {
  addPlanMonths,
  getRenewalBaseDate,
  isExpiredAt,
  normalizePlanMonths,
} from "../../src/lib/api-keys/plans.js";

describe("API key plan helpers", () => {
  it("accepts only supported plan lengths", () => {
    expect(normalizePlanMonths(1)).toBe(1);
    expect(normalizePlanMonths("3")).toBe(3);
    expect(normalizePlanMonths(6)).toBe(6);
    expect(normalizePlanMonths(12)).toBe(12);
    expect(() => normalizePlanMonths(2)).toThrow("Plan must be one of 1, 3, 6, 12 months");
    expect(() => normalizePlanMonths("bad")).toThrow("Plan must be one of 1, 3, 6, 12 months");
  });

  it("adds plan months using UTC calendar dates", () => {
    const start = new Date("2026-06-18T14:52:33.301Z");
    expect(addPlanMonths(start, 1).toISOString()).toBe("2026-07-18T14:52:33.301Z");
    expect(addPlanMonths(start, 3).toISOString()).toBe("2026-09-18T14:52:33.301Z");
  });

  it("clamps month end when target month is shorter", () => {
    const start = new Date("2026-01-31T10:00:00.000Z");
    expect(addPlanMonths(start, 1).toISOString()).toBe("2026-02-28T10:00:00.000Z");
  });

  it("renews from existing future expiration", () => {
    const now = new Date("2026-06-23T00:00:00.000Z");
    const expiresAt = "2026-07-18T14:52:33.301Z";
    expect(getRenewalBaseDate(expiresAt, now).toISOString()).toBe("2026-07-18T14:52:33.301Z");
  });

  it("renews from now when missing or expired", () => {
    const now = new Date("2026-06-23T00:00:00.000Z");
    expect(getRenewalBaseDate(null, now).toISOString()).toBe(now.toISOString());
    expect(getRenewalBaseDate("2026-06-01T00:00:00.000Z", now).toISOString()).toBe(now.toISOString());
  });

  it("detects expiration only when timestamp is present and not in the future", () => {
    const now = new Date("2026-06-23T00:00:00.000Z");
    expect(isExpiredAt(null, now)).toBe(false);
    expect(isExpiredAt("2026-06-22T23:59:59.000Z", now)).toBe(true);
    expect(isExpiredAt("2026-06-23T00:00:00.000Z", now)).toBe(true);
    expect(isExpiredAt("2026-06-23T00:00:01.000Z", now)).toBe(false);
  });
});
