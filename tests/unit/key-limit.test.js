// tests/unit/key-limit.test.js
import { describe, it, expect } from "vitest";
import {
  keyLimitFromColumns, keyLimitToColumns, validateKeyLimitInput, windowStart, windowReset,
} from "../../src/shared/utils/keyLimit.js";
import { keyLimitReachedMessage } from "../../src/shared/constants/keyAccess.js";

describe("columns", () => {
  it("round-trips a limit and reads missing or corrupt columns as no limit", () => {
    expect(keyLimitFromColumns(25, "day")).toEqual({ usd: 25, window: "day" });
    expect(keyLimitToColumns({ usd: 25, window: "month" })).toEqual({ limitUsd: 25, limitWindow: "month" });
    expect(keyLimitToColumns(null)).toEqual({ limitUsd: null, limitWindow: null });
    expect(keyLimitFromColumns(null, null)).toBeNull();
    expect(keyLimitFromColumns(0, "day")).toBeNull();
    expect(keyLimitFromColumns(-1, "day")).toBeNull();
    expect(keyLimitFromColumns(5, "week")).toBeNull();
    expect(keyLimitFromColumns("abc", "day")).toBeNull();
  });
});

describe("validateKeyLimitInput", () => {
  it("accepts null (clear) and a valid limit", () => {
    expect(validateKeyLimitInput(null)).toEqual({ ok: true, value: null });
    expect(validateKeyLimitInput({ usd: 10.5, window: "day" })).toEqual({ ok: true, value: { usd: 10.5, window: "day" } });
  });
  it.each([
    [undefined], ["x"], [[]], [{}], [{ usd: 5 }], [{ window: "day" }],
    [{ usd: 0, window: "day" }], [{ usd: -3, window: "day" }], [{ usd: "5", window: "day" }],
    [{ usd: Infinity, window: "day" }], [{ usd: 2e6, window: "day" }],
    [{ usd: 5, window: "week" }], [{ usd: 5, window: "day", extra: 1 }],
  ])("rejects %j", (input) => {
    expect(validateKeyLimitInput(input).ok).toBe(false);
  });
});

describe("windows (UTC)", () => {
  const now = new Date("2026-11-24T20:30:00.000Z");
  it("day starts at UTC midnight and resets at the next one", () => {
    expect(windowStart("day", now).toISOString()).toBe("2026-11-24T00:00:00.000Z");
    expect(windowReset("day", now).toISOString()).toBe("2026-11-25T00:00:00.000Z");
  });
  it("month starts on the 1st and resets on the 1st of the next month", () => {
    expect(windowStart("month", now).toISOString()).toBe("2026-11-01T00:00:00.000Z");
    expect(windowReset("month", now).toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });
  it("handles the year boundary and the exact boundary instant", () => {
    const dec = new Date("2026-12-31T23:59:59.999Z");
    expect(windowReset("month", dec).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(windowReset("day", dec).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    const edge = new Date("2026-12-01T00:00:00.000Z");
    expect(windowStart("month", edge).toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });
});

describe("message", () => {
  it("names the cap and the reset time and nothing else", () => {
    const m = keyLimitReachedMessage({ usd: 25, window: "day" }, "2026-11-25T00:00:00.000Z");
    expect(m).toBe("This API key has reached its daily cost limit of $25. It resets at 2026-11-25T00:00:00.000Z.");
    expect(keyLimitReachedMessage({ usd: 100, window: "month" }, "x")).toContain("monthly cost limit of $100");
  });
});
