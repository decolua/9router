import { describe, expect, it } from "vitest";
import { formatChinaTime, getChinaDateKey, getChinaDayStart, parseChinaDateTime } from "../../src/shared/utils/chinaTime.js";

describe("China usage time", () => {
  it("formats UTC timestamps as Asia/Shanghai time", () => {
    expect(formatChinaTime("2026-08-24T02:00:00.000Z")).toBe("10:00");
    expect(getChinaDateKey("2026-08-24T16:30:00.000Z")).toBe("2026-08-25");
  });

  it("uses China midnight for daily ranges", () => {
    expect(new Date(getChinaDayStart(new Date("2026-08-24T02:00:00.000Z"))).toISOString()).toBe("2026-08-23T16:00:00.000Z");
  });

  it("parses datetime-local values in China time", () => {
    expect(parseChinaDateTime("2026-08-24T10:00").toISOString()).toBe("2026-08-24T02:00:00.000Z");
    expect(parseChinaDateTime("2026-08-24T02:00:00.000Z").toISOString()).toBe("2026-08-24T02:00:00.000Z");
  });
});
