import { describe, expect, it, beforeAll } from "vitest";
import {
  PRESETS,
  computeRange,
  endsAtNow,
  rangeLabel,
  isValidPreset,
  getPresetBadge,
} from "@/app/(dashboard)/dashboard/pii-guard/ranges.js";

beforeAll(() => {
  process.env.TZ = "Asia/Kolkata";
});

describe("pii-guard ranges", () => {
  // Thursday, 2026-11-05 15:30:00 IST
  const fixedNow = new Date("2026-11-05T15:30:00+05:30").getTime();

  it("exports valid PRESETS array with correct IDs and sections", () => {
    const expectedIds = [
      "15m", "30m", "1h", "3h", "24h", "48h", "7d", "30d", "90d",
      "today", "yesterday", "thisWeek", "prevWeek", "thisMonth", "prevMonth",
    ];
    expect(PRESETS.map((p) => p.id)).toEqual(expectedIds);

    for (const p of PRESETS) {
      expect(["rolling", "calendar"]).toContain(p.section);
      expect(typeof p.short).toBe("string");
      expect(typeof p.label).toBe("string");
    }
  });

  it("isValidPreset checks known IDs and custom", () => {
    for (const p of PRESETS) {
      expect(isValidPreset(p.id)).toBe(true);
    }
    expect(isValidPreset("custom")).toBe(true);
    expect(isValidPreset("unknown")).toBe(false);
    expect(isValidPreset("")).toBe(false);
    expect(isValidPreset(null)).toBe(false);
  });

  it("endsAtNow returns true for rolling presets, today, thisWeek, and thisMonth", () => {
    const expectedTrue = [
      "15m", "30m", "1h", "3h", "24h", "48h", "7d", "30d", "90d",
      "today", "thisWeek", "thisMonth",
    ];
    const expectedFalse = ["yesterday", "prevWeek", "prevMonth", "custom"];

    for (const id of expectedTrue) {
      expect(endsAtNow(id), `endsAtNow(${id}) should be true`).toBe(true);
    }
    for (const id of expectedFalse) {
      expect(endsAtNow(id), `endsAtNow(${id}) should be false`).toBe(false);
    }
  });

  describe("computeRange with fixed now", () => {
    it("computes 24h correctly", () => {
      const r = computeRange("24h", null, null, fixedNow);
      expect(r).toEqual({
        from: fixedNow - 24 * 3600 * 1000,
        to: fixedNow,
      });
    });

    it("computes today correctly (starts at local midnight, ends at now)", () => {
      const r = computeRange("today", null, null, fixedNow);
      const startOfToday = new Date(fixedNow);
      startOfToday.setHours(0, 0, 0, 0);

      expect(r.from).toBe(startOfToday.getTime());
      expect(r.to).toBe(fixedNow);
    });

    it("computes yesterday correctly (full previous local day)", () => {
      const r = computeRange("yesterday", null, null, fixedNow);
      const startOfToday = new Date(fixedNow);
      startOfToday.setHours(0, 0, 0, 0);
      const startOfYesterday = new Date(startOfToday);
      startOfYesterday.setDate(startOfYesterday.getDate() - 1);

      expect(r.from).toBe(startOfYesterday.getTime());
      expect(r.to).toBe(startOfToday.getTime());
      expect(r.to - r.from).toBe(24 * 3600 * 1000);
    });

    it("computes thisWeek correctly starting Monday 00:00, ending at now", () => {
      const r = computeRange("thisWeek", null, null, fixedNow);
      // 2026-11-05 is Thursday; Monday was 2026-11-02
      const startOfWeek = new Date(fixedNow);
      const diff = startOfWeek.getDay() === 0 ? -6 : 1 - startOfWeek.getDay();
      startOfWeek.setDate(startOfWeek.getDate() + diff);
      startOfWeek.setHours(0, 0, 0, 0);

      expect(r.from).toBe(startOfWeek.getTime());
      expect(new Date(r.from).getDay()).toBe(1); // Monday
      expect(r.to).toBe(fixedNow);
    });

    it("computes prevWeek correctly (full previous Monday-to-Monday week)", () => {
      const r = computeRange("prevWeek", null, null, fixedNow);
      const startOfWeek = new Date(fixedNow);
      const diff = startOfWeek.getDay() === 0 ? -6 : 1 - startOfWeek.getDay();
      startOfWeek.setDate(startOfWeek.getDate() + diff);
      startOfWeek.setHours(0, 0, 0, 0);

      const startOfPrevWeek = new Date(startOfWeek);
      startOfPrevWeek.setDate(startOfPrevWeek.getDate() - 7);

      expect(r.from).toBe(startOfPrevWeek.getTime());
      expect(r.to).toBe(startOfWeek.getTime());
      expect(r.to - r.from).toBe(7 * 24 * 3600 * 1000);
      expect(new Date(r.from).getDay()).toBe(1); // Monday
      expect(new Date(r.to).getDay()).toBe(1); // Monday
    });

    it("computes thisMonth correctly starting 1st of month 00:00, ending at now", () => {
      const r = computeRange("thisMonth", null, null, fixedNow);
      const startOfMonth = new Date(fixedNow);
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);

      expect(r.from).toBe(startOfMonth.getTime());
      expect(new Date(r.from).getDate()).toBe(1);
      expect(r.to).toBe(fixedNow);
    });

    it("computes prevMonth correctly (full previous month)", () => {
      const r = computeRange("prevMonth", null, null, fixedNow);
      const startOfThisMonth = new Date(fixedNow);
      startOfThisMonth.setDate(1);
      startOfThisMonth.setHours(0, 0, 0, 0);

      const startOfPrevMonth = new Date(startOfThisMonth);
      startOfPrevMonth.setMonth(startOfPrevMonth.getMonth() - 1);

      expect(r.from).toBe(startOfPrevMonth.getTime());
      expect(r.to).toBe(startOfThisMonth.getTime());
      expect(new Date(r.from).getDate()).toBe(1);
      // October 2026 has 31 days
      expect(r.to - r.from).toBe(31 * 24 * 3600 * 1000);
    });

    it("computes custom correctly with customFrom and customTo", () => {
      const cFrom = fixedNow - 50000;
      const cTo = fixedNow - 1000;
      const r = computeRange("custom", cFrom, cTo, fixedNow);
      expect(r).toEqual({ from: cFrom, to: cTo });
    });

    it("falls back to past 24h when custom has missing bounds", () => {
      const r1 = computeRange("custom", null, null, fixedNow);
      expect(r1).toEqual({ from: fixedNow - 24 * 3600 * 1000, to: fixedNow });

      const r2 = computeRange("custom", fixedNow - 1000, null, fixedNow);
      expect(r2).toEqual({ from: fixedNow - 24 * 3600 * 1000, to: fixedNow });
    });
  });

  it("asserts that no preset spans more than 90 days", () => {
    const maxSpan = 90 * 24 * 3600 * 1000;
    for (const preset of PRESETS) {
      const range = computeRange(preset.id, null, null, fixedNow);
      const span = range.to - range.from;
      expect(span).toBeGreaterThan(0);
      expect(span, `Preset ${preset.id} spans ${span / 86400000} days`).toBeLessThanOrEqual(maxSpan);
    }
  });

  describe("rangeLabel", () => {
    it("returns lowercase phrases for presets", () => {
      expect(rangeLabel("24h")).toBe("past 24 hours");
      expect(rangeLabel("thisWeek")).toBe("this week");
      expect(rangeLabel("today")).toBe("today");
      expect(rangeLabel("yesterday")).toBe("yesterday");
      expect(rangeLabel("prevWeek")).toBe("prev week");
      expect(rangeLabel("thisMonth")).toBe("this month");
      expect(rangeLabel("prevMonth")).toBe("prev month");
    });

    it("formats custom range with en-dash and date/time", () => {
      const f = new Date("2026-11-04T10:00:00+05:30").getTime();
      const t = new Date("2026-11-05T09:00:00+05:30").getTime();
      expect(rangeLabel("custom", f, t)).toBe("4 Nov 10:00 – 5 Nov 09:00");
    });
  });

  describe("getPresetBadge", () => {
    it("returns live span for today, thisWeek, thisMonth", () => {
      // 15:30 IST -> 15h
      expect(getPresetBadge("today", fixedNow)).toBe("15h");
      // Thursday -> 4d
      expect(getPresetBadge("thisWeek", fixedNow)).toBe("4d");
      // 5th of Nov -> 5d
      expect(getPresetBadge("thisMonth", fixedNow)).toBe("5d");
    });

    it("returns static badges for completed and rolling presets", () => {
      expect(getPresetBadge("yesterday", fixedNow)).toBe("1d");
      expect(getPresetBadge("prevWeek", fixedNow)).toBe("7d");
      expect(getPresetBadge("prevMonth", fixedNow)).toBe("31d");
      expect(getPresetBadge("24h", fixedNow)).toBe("1d");
      expect(getPresetBadge("7d", fixedNow)).toBe("1w");
    });
  });
});
