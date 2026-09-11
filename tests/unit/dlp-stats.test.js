// Privacy stats persistence: recordDlpMasks / getDlpStats / getDlpChartData.
// Isolated via temp DATA_DIR like the other DB tests.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-dlp-stats-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

function localIsoWithHours(hours, minutes = 0) {
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d.toISOString();
}

function daysAgoIso(days, hours = 12) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hours, 0, 0, 0);
  return d.toISOString();
}

describe("recordDlpMasks", () => {
  it("records request/response events and aggregates them by scope", async () => {
    const { recordDlpMasks, getDlpStats } = await import("@/lib/db/repos/dlpStatsRepo.js");

    await recordDlpMasks({ scope: "request", mode: "redact", matched: 3, byType: { email: 2, phone: 1 } });
    await recordDlpMasks({ scope: "request", mode: "redact", matched: 1, byType: { cpf: 1 } });
    await recordDlpMasks({ scope: "response", mode: "redact", matched: 2, byType: { email: 2 } });

    const stats = await getDlpStats("7d");
    expect(stats.totalMatched).toBe(6);
    expect(stats.maskedRequests).toBe(2);
    expect(stats.maskedResponses).toBe(1);
    expect(stats.byType).toEqual({ email: 4, phone: 1, cpf: 1 });
    expect(stats.topCategory).toEqual({ name: "email", count: 4 });
    expect(stats.mode).toBe("redact");
  });

  it("keeps the latest mode seen in the period", async () => {
    const { recordDlpMasks, getDlpStats } = await import("@/lib/db/repos/dlpStatsRepo.js");

    await recordDlpMasks({ scope: "request", mode: "redact", matched: 2, byType: { email: 2 }, timestamp: daysAgoIso(2) });
    await recordDlpMasks({ scope: "request", mode: "pseudo", matched: 1, byType: { phone: 1 }, timestamp: daysAgoIso(1) });

    const stats = await getDlpStats("7d");
    expect(stats.mode).toBe("pseudo");
  });

  it("ignores zero-matched and unknown scopes (no rows)", async () => {
    const { recordDlpMasks, getDlpStats } = await import("@/lib/db/repos/dlpStatsRepo.js");

    await recordDlpMasks({ scope: "request", matched: 0, byType: {} });
    await recordDlpMasks({ scope: "weird", matched: 5, byType: { email: 5 } });

    const stats = await getDlpStats("7d");
    expect(stats.totalMatched).toBe(0);
    expect(stats.maskedRequests).toBe(0);
  });

  it("is fail-open: never throws when the DB is broken", async () => {
    vi.doMock("@/lib/db/driver.js", () => ({
      getAdapter: () => Promise.reject(new Error("simulated db failure")),
    }));
    const { recordDlpMasks } = await import("@/lib/db/repos/dlpStatsRepo.js");
    await expect(
      recordDlpMasks({ scope: "request", matched: 3, byType: { email: 3 } })
    ).resolves.toBeUndefined();
    vi.doUnmock("@/lib/db/driver.js");
  });
});

describe("getDlpStats period filtering", () => {
  it("excludes events older than the requested window", async () => {
    const { recordDlpMasks, getDlpStats } = await import("@/lib/db/repos/dlpStatsRepo.js");

    await recordDlpMasks({ scope: "request", matched: 5, byType: { email: 5 }, timestamp: daysAgoIso(10) });
    await recordDlpMasks({ scope: "request", matched: 2, byType: { phone: 2 }, timestamp: daysAgoIso(1) });

    const week = await getDlpStats("7d");
    expect(week.totalMatched).toBe(2);
    expect(week.byType).toEqual({ phone: 2 });

    const month = await getDlpStats("30d");
    expect(month.totalMatched).toBe(7);
    expect(month.byType).toEqual({ email: 5, phone: 2 });
  });

  it("'today' only counts events since local midnight", async () => {
    const { recordDlpMasks, getDlpStats } = await import("@/lib/db/repos/dlpStatsRepo.js");

    await recordDlpMasks({ scope: "request", matched: 4, byType: { cpf: 4 }, timestamp: daysAgoIso(1) });
    await recordDlpMasks({ scope: "request", matched: 1, byType: { email: 1 }, timestamp: localIsoWithHours(0, 30) });

    const today = await getDlpStats("today");
    expect(today.totalMatched).toBe(1);
  });
});

describe("getDlpChartData", () => {
  it("builds 24 hourly buckets for today with events placed by local hour", async () => {
    const { recordDlpMasks, getDlpChartData } = await import("@/lib/db/repos/dlpStatsRepo.js");

    await recordDlpMasks({ scope: "request", matched: 2, byType: { email: 2 }, timestamp: localIsoWithHours(0, 30) });
    await recordDlpMasks({ scope: "response", matched: 3, byType: { email: 3 }, timestamp: localIsoWithHours(1, 15) });

    const chart = await getDlpChartData("today");
    expect(chart).toHaveLength(24);
    expect(chart[0].requests).toBe(1);
    expect(chart[0].masked).toBe(2);
    expect(chart[1].responses).toBe(1);
    expect(chart[1].masked).toBe(3);
    expect(chart.every((b) => b.label)).toBe(true);
  });

  it("aggregates daily for 7d and zero-fills missing days", async () => {
    const { recordDlpMasks, getDlpChartData } = await import("@/lib/db/repos/dlpStatsRepo.js");

    await recordDlpMasks({ scope: "request", matched: 2, byType: { email: 2 }, timestamp: daysAgoIso(0) });
    await recordDlpMasks({ scope: "response", matched: 4, byType: { phone: 4 }, timestamp: daysAgoIso(1) });

    const chart = await getDlpChartData("7d");
    expect(chart).toHaveLength(7);
    expect(chart[6].requests).toBe(1);
    expect(chart[6].masked).toBe(2);
    expect(chart[5].responses).toBe(1);
    expect(chart[5].masked).toBe(4);
    expect(chart[0].masked).toBe(0);
    expect(chart.every((b) => b.label)).toBe(true);
  });
});