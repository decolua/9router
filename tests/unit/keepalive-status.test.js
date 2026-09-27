import { describe, it, expect } from "vitest";
import { describeKeepalive, formatKeepaliveTime } from "@/shared/utils/keepaliveStatus";

const schedule = { enabled: true, expressions: ["0 7 * * *"], timezone: "Asia/Seoul" };

describe("describeKeepalive", () => {
  it("says nothing for an account with no active schedule", () => {
    expect(describeKeepalive({ lastSentAt: "2026-09-27T00:00:00Z" }, null)).toBeNull();
    expect(describeKeepalive({}, { expressions: [] })).toBeNull();
    expect(describeKeepalive({}, { ...schedule, enabled: false })).toBeNull();
  });

  it("reports a scheduled account that has not pinged yet", () => {
    expect(describeKeepalive({}, schedule)).toMatchObject({ tone: "pending", at: null, timezone: "Asia/Seoul" });
    expect(describeKeepalive(undefined, schedule).tone).toBe("pending");
  });

  it("reports the last successful ping", () => {
    const s = describeKeepalive({ lastSentAt: "2026-09-26T22:00:05Z" }, schedule);
    expect(s).toMatchObject({ tone: "ok", at: "2026-09-26T22:00:05Z" });
  });

  it("reports a failure that is newer than the last success", () => {
    const s = describeKeepalive({ lastSentAt: "2026-09-26T22:00:05Z", lastFailedAt: "2026-09-27T03:00:10Z" }, schedule);
    expect(s).toMatchObject({ tone: "failed", at: "2026-09-27T03:00:10Z" });
  });

  it("treats a failure the retry already recovered from as success", () => {
    const s = describeKeepalive({ lastSentAt: "2026-09-27T03:05:10Z", lastFailedAt: "2026-09-27T03:00:10Z" }, schedule);
    expect(s.tone).toBe("ok");
  });

  it("carries a null timezone through so the card can say it runs on server time", () => {
    expect(describeKeepalive({}, { expressions: ["0 7 * * *"] }).timezone).toBeNull();
  });
});

describe("formatKeepaliveTime", () => {
  it("shows the time in the schedule's zone, and names the zone", () => {
    // 22:00 UTC is 07:00 the next day in Seoul.
    expect(formatKeepaliveTime("2026-09-26T22:00:05Z", "Asia/Seoul")).toBe("09-27 07:00 (Asia/Seoul)");
  });

  it("labels an unset zone as server time", () => {
    expect(formatKeepaliveTime(null, null)).toBe("(server time)");
    expect(formatKeepaliveTime("2026-09-26T22:00:05Z", null)).toMatch(/\(server time\)$/);
  });

  it("does not throw on garbage input", () => {
    expect(formatKeepaliveTime("not a date", "Asia/Seoul")).toBe("(Asia/Seoul)");
    expect(formatKeepaliveTime("2026-09-26T22:00:05Z", "Not/AZone")).toMatch(/\(Not\/AZone\)$/);
  });
});
