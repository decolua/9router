// Test latency tracking in usageRepo
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-latency-repo-"));
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

describe("usageRepo latency", () => {
  it("saveRequestUsage stores ttft and totalLatency", async () => {
    const { saveRequestUsage } = await import("@/lib/db/repos/usageRepo.js");
    const { getAdapter } = await import("@/lib/db/driver.js");

    await saveRequestUsage({
      timestamp: new Date().toISOString(),
      provider: "openai",
      model: "gpt-4",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
      cost: 0.01,
      status: "ok",
      ttft: 150,
      totalLatency: 450,
    });

    const db = await getAdapter();
    const row = db.get(`SELECT ttft, totalLatency FROM usageHistory LIMIT 1`);
    expect(row.ttft).toBe(150);
    expect(row.totalLatency).toBe(450);
  });

  it("saveRequestUsage defaults latency to 0 when not provided", async () => {
    const { saveRequestUsage } = await import("@/lib/db/repos/usageRepo.js");
    const { getAdapter } = await import("@/lib/db/driver.js");

    await saveRequestUsage({
      timestamp: new Date().toISOString(),
      provider: "openai",
      model: "gpt-4",
      tokens: { prompt_tokens: 50, completion_tokens: 20 },
      cost: 0.005,
      status: "ok",
    });

    const db = await getAdapter();
    const row = db.get(`SELECT ttft, totalLatency FROM usageHistory LIMIT 1`);
    expect(row.ttft).toBe(0);
    expect(row.totalLatency).toBe(0);
  });

  it("getChartData returns avg ttft and totalLatency per bucket (24h)", async () => {
    const { saveRequestUsage, getChartData } = await import("@/lib/db/repos/usageRepo.js");

    // Insert two entries in different hour buckets
    const now = new Date();
    // 2 hours ago (bucket 22)
    const ts1 = new Date(now.getTime() - 2 * 3600000).toISOString();
    // 1 hour ago (bucket 23)
    const ts2 = new Date(now.getTime() - 1 * 3600000).toISOString();

    await saveRequestUsage({
      timestamp: ts1,
      provider: "openai",
      model: "gpt-4",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
      cost: 0.01,
      status: "ok",
      ttft: 200,
      totalLatency: 500,
    });

    await saveRequestUsage({
      timestamp: ts2,
      provider: "openai",
      model: "gpt-4",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
      cost: 0.01,
      status: "ok",
      ttft: 100,
      totalLatency: 300,
    });

    const data = await getChartData("24h");
    // Both entries should be in different buckets (last two hours)
    const bucketsWithData = data.filter(d => d.ttft > 0 || d.totalLatency > 0);
    expect(bucketsWithData.length).toBeGreaterThanOrEqual(2);

    // Check the bucket with the second entry (1 hour ago, should be 2nd to last bucket)
    const secondToLastBucket = data[data.length - 2];
    expect(secondToLastBucket.ttft).toBe(100);
    expect(secondToLastBucket.totalLatency).toBe(300);
  });

  it("getChartData returns ttft and totalLatency for 'today' period", async () => {
    const { saveRequestUsage, getChartData } = await import("@/lib/db/repos/usageRepo.js");

    const now = new Date().toISOString();
    await saveRequestUsage({
      timestamp: now,
      provider: "anthropic",
      model: "claude-3",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
      cost: 0.02,
      status: "ok",
      ttft: 300,
      totalLatency: 600,
    });

    const data = await getChartData("today");
    expect(data.length).toBe(24);

    const bucketsWithData = data.filter(d => d.ttft > 0 || d.totalLatency > 0);
    expect(bucketsWithData.length).toBeGreaterThanOrEqual(1);
    const b = bucketsWithData[0];
    expect(b.ttft).toBe(300);
    expect(b.totalLatency).toBe(600);
  });

  it("getChartData returns ttft and totalLatency for multi-day periods (7d)", async () => {
    const { saveRequestUsage, getChartData } = await import("@/lib/db/repos/usageRepo.js");

    const now = new Date();
    const ts1 = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(); // 3 days ago
    const ts2 = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(); // 1 day ago

    await saveRequestUsage({
      timestamp: ts1,
      provider: "anthropic",
      model: "claude-3",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
      cost: 0.02,
      ttft: 400,
      totalLatency: 800,
    });

    await saveRequestUsage({
      timestamp: ts2,
      provider: "anthropic",
      model: "claude-3",
      tokens: { prompt_tokens: 100, completion_tokens: 50 },
      cost: 0.02,
      ttft: 200,
      totalLatency: 400,
    });

    const data = await getChartData("7d");
    expect(data.length).toBe(7);
    expect(data[0]).toHaveProperty("ttft");
    expect(data[0]).toHaveProperty("totalLatency");
  });

  it("getChartData returns 0 for latency on empty data", async () => {
    const { getChartData } = await import("@/lib/db/repos/usageRepo.js");
    const data = await getChartData("24h");
    expect(data.length).toBe(24);
    for (const d of data) {
      expect(d.ttft).toBe(0);
      expect(d.totalLatency).toBe(0);
    }
  });
});

describe("usageRepo latency percentiles", () => {
  it("getUsageStats returns p50Ttft and p95Ttft per model", async () => {
    const { saveRequestUsage, getUsageStats } = await import("@/lib/db/repos/usageRepo.js");

    // Insert 5 requests with ttft values: 100, 200, 300, 400, 500
    const now = new Date();
    const base = now.getTime() - 3600000; // 1 hour ago
    for (let i = 0; i < 5; i++) {
      await saveRequestUsage({
        timestamp: new Date(base + i * 1000).toISOString(),
        provider: "openai",
        model: "gpt-4",
        tokens: { prompt_tokens: 100, completion_tokens: 50 },
        cost: 0.01,
        ttft: 100 + i * 100,
        totalLatency: 200 + i * 100,
      });
    }

    const stats = await getUsageStats("24h");
    const modelKey = "gpt-4 (openai)";
    expect(stats.latencyByModel[modelKey]).toBeDefined();
    const lat = stats.latencyByModel[modelKey];
    // P50 of [100,200,300,400,500] = 300 (index 2, 0-based)
    // P95 of [100,200,300,400,500] = 500 (index 4, ceil(5*0.95)-1 = 4)
    expect(lat.p50Ttft).toBe(300);
    expect(lat.p95Ttft).toBe(500);
    // P50 of [200,300,400,500,600] = 400
    expect(lat.p50Total).toBe(400);
    expect(lat.p95Total).toBe(600);
  });
});