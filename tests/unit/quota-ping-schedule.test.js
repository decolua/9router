import { describe, expect, it } from "vitest";

import {
  PING_SCHEDULE_DEFAULTS,
  getDuePingSlot,
  getNextPingSlot,
  getScheduleSlotLabels,
  maxSlotsPerDay,
  normalizePingSchedule,
} from "../../src/shared/services/quotaPingSchedule.js";

const BRT = {
  enabled: true,
  anchor: "09:30",
  timezone: "America/Sao_Paulo",
  windowHours: 5,
  slotsPerDay: 3,
};

const at = (iso) => new Date(iso).getTime();

describe("quota ping schedule", () => {
  it("ignores absent or disabled schedules", () => {
    expect(normalizePingSchedule(null)).toBeNull();
    expect(normalizePingSchedule({ enabled: false, anchor: "09:30" })).toBeNull();
    expect(getDuePingSlot(null, at("2026-08-20T12:30:00.000Z"))).toBeNull();
  });

  it("falls back to defaults on invalid anchor, timezone and counts", () => {
    const schedule = normalizePingSchedule({
      enabled: true,
      anchor: "99:99",
      timezone: "Mars/Olympus",
      windowHours: 0,
      slotsPerDay: 99,
    });

    expect(schedule).toEqual({
      enabled: true,
      anchor: "09:30",
      timezone: PING_SCHEDULE_DEFAULTS.timezone,
      windowHours: 0.5,
      slotsPerDay: 48,
    });
  });

  it("caps pings per day so slots never overlap the next anchor", () => {
    expect(maxSlotsPerDay(5)).toBe(4);
    expect(normalizePingSchedule({ ...BRT, slotsPerDay: 9 }).slotsPerDay).toBe(4);
  });

  it("lists the daily slots in local time", () => {
    expect(getScheduleSlotLabels(BRT)).toEqual(["09:30", "14:30", "19:30"]);
    expect(getScheduleSlotLabels({ ...BRT, slotsPerDay: 4 })).toEqual(["09:30", "14:30", "19:30", "00:30"]);
  });

  it("fires the anchor slot right after its local time (09:30 BRT = 12:30 UTC)", () => {
    const slot = getDuePingSlot(BRT, at("2026-08-20T12:31:00.000Z"));
    expect(slot).toMatchObject({ key: "2026-08-20#0", index: 0 });
    expect(new Date(slot.at).toISOString()).toBe("2026-08-20T12:30:00.000Z");
  });

  it("fires the later slots of the same anchor day", () => {
    expect(getDuePingSlot(BRT, at("2026-08-20T17:30:00.000Z"))).toMatchObject({ key: "2026-08-20#1" });
    expect(getDuePingSlot(BRT, at("2026-08-20T22:30:00.000Z"))).toMatchObject({ key: "2026-08-20#2" });
  });

  it("does not fire a slot that is already stale", () => {
    expect(getDuePingSlot(BRT, at("2026-08-20T13:29:00.000Z"))).toBeNull();
  });

  it("stays quiet overnight and re-anchors the next morning", () => {
    // 03:00 BRT — the 19:30 window ended at 00:30 and nothing runs until 09:30.
    expect(getDuePingSlot(BRT, at("2026-08-20T06:00:00.000Z"))).toBeNull();
    expect(new Date(getNextPingSlot(BRT, at("2026-08-20T06:00:00.000Z")).at).toISOString())
      .toBe("2026-08-20T12:30:00.000Z");
  });

  it("keys slots by the local anchor day, not the UTC day", () => {
    // 22:30 BRT on 2026-08-20 is already 2026-08-21 in UTC.
    const slot = getDuePingSlot({ ...BRT, anchor: "22:30", slotsPerDay: 1 }, at("2026-08-21T01:31:00.000Z"));
    expect(slot.key).toBe("2026-08-20#0");
  });

  it("honours a different timezone", () => {
    const utc = { ...BRT, timezone: "UTC" };
    expect(getDuePingSlot(utc, at("2026-08-20T09:31:00.000Z"))).toMatchObject({ key: "2026-08-20#0" });
    expect(getDuePingSlot(utc, at("2026-08-20T12:31:00.000Z"))).toBeNull();
  });

  it("resolves wall-clock time across a DST transition", () => {
    // US DST ends 2026-11-01: 09:30 New York is 13:30 UTC before and 14:30 UTC after.
    const ny = { ...BRT, timezone: "America/New_York", slotsPerDay: 1 };
    expect(new Date(getDuePingSlot(ny, at("2026-10-30T13:31:00.000Z")).at).toISOString())
      .toBe("2026-10-30T13:30:00.000Z");
    expect(new Date(getDuePingSlot(ny, at("2026-11-02T14:31:00.000Z")).at).toISOString())
      .toBe("2026-11-02T14:30:00.000Z");
  });
});
