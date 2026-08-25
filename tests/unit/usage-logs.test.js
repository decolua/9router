import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;
let settingsRepo;

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-usage-logs-"));
  process.env.DATA_DIR = tempDir;
  vi.resetModules();
  db = await import("@/lib/db/repos/usageRepo.js");
  settingsRepo = await import("@/lib/db/repos/settingsRepo.js");
});

afterAll(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  global._dbAdapter = { instance: null, initPromise: null, logged: false };
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("usage logs", () => {
  it("reads cache tokens from nested provider usage when top-level values are zero", async () => {
    await db.saveRequestUsage({
      provider: "nested-cache-provider",
      model: "nested-cache-model",
      status: "200 OK",
      timestamp: "2026-08-21T01:00:00.000Z",
      tokens: {
        prompt_tokens: 500,
        completion_tokens: 50,
        cached_tokens: 0,
        cache_creation_input_tokens: 0,
        prompt_tokens_details: {
          cached_tokens: 120,
          cache_creation_tokens: 40,
        },
      },
    });

    const result = await db.getUsageLogs({ provider: "nested-cache-provider" });

    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].cacheReadTokens).toBe(120);
    expect(result.logs[0].cacheCreationTokens).toBe(40);
    expect(result.logs[0].cacheHitRate).toBe(24);
    expect(result.logs[0].logType).toBe("success");
  });

  it("reads OpenAI-compatible cache hit and miss token aliases", async () => {
    await db.saveRequestUsage({
      provider: "cache-alias-provider",
      model: "cache-alias-model",
      status: "200 OK",
      timestamp: "2026-08-21T02:00:00.000Z",
      tokens: {
        prompt_tokens: 500,
        completion_tokens: 50,
        prompt_cache_hit_tokens: 120,
        prompt_cache_miss_tokens: 380,
      },
    });

    const result = await db.getUsageLogs({ provider: "cache-alias-provider" });

    expect(result.logs).toHaveLength(1);
    expect(result.logs[0].cacheReadTokens).toBe(120);
    expect(result.logs[0].cacheCreationTokens).toBe(380);
    expect(result.logs[0].cacheHitRate).toBe(24);
  });

  it("sorts traffic logs by cache hit rate", async () => {
    const timestamp = new Date().toISOString();
    await db.saveRequestUsage({
      provider: "cache-rate-provider",
      model: "low-cache-model",
      status: "200 OK",
      timestamp,
      tokens: { prompt_tokens: 500, completion_tokens: 10, cached_tokens: 100 },
    });
    await db.saveRequestUsage({
      provider: "cache-rate-provider",
      model: "high-cache-model",
      status: "200 OK",
      timestamp,
      tokens: { prompt_tokens: 500, completion_tokens: 10, cached_tokens: 400 },
    });

    const result = await db.getUsageLogs({
      provider: "cache-rate-provider",
      sortBy: "cacheHitRate",
      sortOrder: "desc",
    });

    expect(result.logs.map((log) => [log.model, log.cacheHitRate])).toEqual([
      ["high-cache-model", 80],
      ["low-cache-model", 20],
    ]);
  });

  it("builds token trend components and cache hit rate from canonical usage", async () => {
    await db.saveRequestUsage({
      provider: "trend-breakdown-provider",
      model: "trend-breakdown-model",
      status: "200 OK",
      timestamp: "2026-08-22T03:15:00.000Z",
      tokens: {
        prompt_tokens: 500,
        completion_tokens: 50,
        cached_tokens: 300,
        cache_creation_input_tokens: 100,
      },
    });

    const chart = await db.getChartData("custom", {
      startDate: "2026-08-22T11:00",
      endDate: "2026-08-22T12:00",
    });

    expect(chart).toHaveLength(1);
    expect(chart[0]).toMatchObject({
      label: "11:00",
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 300,
      cacheCreationTokens: 100,
      cacheHitRate: 60,
      tokens: 550,
    });
  });

  it("keeps API keys with the same prefix separate in key analysis", async () => {
    const timestamp = new Date().toISOString();
    const base = {
      provider: "key-collision-provider",
      model: "key-collision-model",
      status: "200 OK",
      timestamp,
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
    };
    await db.saveRequestUsage({ ...base, apiKey: "sk_9router_same_prefix_first_a1b2" });
    await db.saveRequestUsage({ ...base, apiKey: "sk_9router_same_prefix_second_c3d4" });

    const stats = await db.getUsageStats("24h");
    const entries = Object.values(stats.byApiKey).filter((entry) => entry.rawModel === "key-collision-model");

    expect(entries).toHaveLength(2);
    expect(new Set(entries.map((entry) => entry.apiKeyKey)).size).toBe(2);
    expect(entries.map((entry) => entry.keyName).sort()).toEqual([
      "sk_9rout...a1b2",
      "sk_9rout...c3d4",
    ]);
  });

  it("aligns rolling 24-hour chart labels to whole hours", async () => {
    const chart = await db.getChartData("24h");
    expect(chart).toHaveLength(24);
    expect(chart.every((point) => /^\d{4}-\d{2}-\d{2} \d{2}:00$/.test(point.label))).toBe(true);
  });

  it("persists terminal failures without duplicating pending or successful lifecycle events", async () => {
    const now = Date.now();
    const base = {
      provider: "failure-log-provider",
      model: "failure-log-model",
      connectionId: "connection-1",
      apiKey: "sk-failure-log-key",
      endpoint: "/v1/chat/completions",
    };

    await db.appendRequestLog({ ...base, status: "PENDING", timestamp: new Date(now - 2000).toISOString() });
    await db.appendRequestLog({ ...base, status: "200 OK", timestamp: new Date(now - 1000).toISOString() });
    await db.appendRequestLog({ ...base, status: "FAILED 502", timestamp: new Date(now).toISOString() });

    const all = await db.getUsageLogs({ provider: "failure-log-provider" });
    const failed = await db.getUsageLogs({ provider: "failure-log-provider", status: "failed" });
    const successful = await db.getUsageLogs({ provider: "failure-log-provider", status: "success" });
    const stats = await db.getUsageStats("24h");
    const keyUsage = Object.values(stats.byApiKey).find((entry) => entry.rawModel === "failure-log-model");

    expect(all.logs).toHaveLength(1);
    expect(all.logs[0]).toMatchObject({
      status: "FAILED 502",
      logType: "failed",
      endpoint: "/v1/chat/completions",
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      outputTokens: 0,
      cost: 0,
    });
    expect(failed.logs).toHaveLength(1);
    expect(successful.logs).toHaveLength(0);
    expect(keyUsage?.requests).toBe(1);
  });

  it("builds model traffic and latency curves from usage history", async () => {
    await db.saveRequestUsage({
      provider: "curve-provider",
      model: "curve-model",
      timestamp: new Date().toISOString(),
      tokens: { prompt_tokens: 80, completion_tokens: 20 },
      meta: { latency: { ttft: 120, total: 640 } },
    });

    const traffic = await db.getDimensionChartData("today", {}, "model", "tokens");
    const latency = await db.getDimensionChartData("today", {}, "model", "latency");
    const trafficSeries = traffic.series.find((series) => series.label === "curve-model");
    const latencySeries = latency.series.find((series) => series.label === "curve-model");

    expect(traffic.data.reduce((sum, point) => sum + Number(point[trafficSeries.id] || 0), 0)).toBe(100);
    expect(latency.data.some((point) => point[latencySeries.id] === 640)).toBe(true);
  });

  it("can merge or separate matching model names across providers", async () => {
    const timestamp = new Date().toISOString();
    const base = {
      model: "shared-curve-model",
      timestamp,
      tokens: { prompt_tokens: 30, completion_tokens: 10 },
      meta: { latency: { total: 500 } },
    };
    await db.saveRequestUsage({ ...base, provider: "curve-provider-a" });
    await db.saveRequestUsage({ ...base, provider: "curve-provider-b", meta: { latency: { total: 900 } } });

    const merged = await db.getDimensionChartData("today", {}, "model", "tokens", { mergeModels: true });
    const separated = await db.getDimensionChartData("today", {}, "model", "latency", { mergeModels: false });
    const mergedSeries = merged.series.filter((series) => series.label === "shared-curve-model");
    const separatedSeries = separated.series.filter((series) => series.label.startsWith("shared-curve-model · "));

    expect(mergedSeries).toHaveLength(1);
    expect(merged.data.reduce((sum, point) => sum + Number(point[mergedSeries[0].id] || 0), 0)).toBe(80);
    expect(separatedSeries).toHaveLength(2);
    expect(new Set(separatedSeries.map((series) => series.label))).toEqual(new Set([
      "shared-curve-model · curve-provider-a",
      "shared-curve-model · curve-provider-b",
    ]));
  });

  it("returns custom provider names and request latency in traffic logs", async () => {
    await settingsRepo.updateSettings({ providerDisplayNames: { "renamed-provider": "团队供应商" } });
    await db.saveRequestUsage({
      provider: "renamed-provider",
      model: "renamed-model",
      timestamp: new Date().toISOString(),
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      meta: { latency: { ttft: 125, total: 875 } },
    });

    const result = await db.getUsageLogs({ provider: "renamed-provider" });

    expect(result.logs[0]).toMatchObject({
      providerId: "renamed-provider",
      provider: "团队供应商",
      ttftMs: 125,
      latencyMs: 875,
    });
    const providerChart = await db.getDimensionChartData("today", {}, "provider", "tokens");
    expect(providerChart.series.some((series) => series.label === "团队供应商")).toBe(true);
  });

  it("returns the user-selected and actual upstream models in traffic logs", async () => {
    await db.saveRequestUsage({
      provider: "dual-model-provider",
      model: "router-model",
      timestamp: new Date().toISOString(),
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      meta: {
        requestedModel: "combo-name",
        actualModel: "upstream/provider-model",
        routerSelectedModel: "glm",
        routerSelectedProvider: "deepseek",
      },
    });

    const result = await db.getUsageLogs({ provider: "dual-model-provider" });

    expect(result.logs[0]).toMatchObject({
      selectedModel: "combo-name",
      actualModel: "upstream/provider-model",
      routerSelectedModel: "glm",
      routerSelectedProvider: "deepseek",
    });
  });

  it("covers the complete custom range when chart data is capped at 90 points", async () => {
    const startDate = "2026-01-01T00:00:00.000Z";
    const endDate = "2026-08-24T00:00:00.000Z";
    await db.saveRequestUsage({
      provider: "long-range-provider",
      model: "long-range-model",
      timestamp: "2026-08-23T12:00:00.000Z",
      tokens: { prompt_tokens: 30, completion_tokens: 10 },
    });

    const chart = await db.getDimensionChartData("custom", { startDate, endDate }, "model", "tokens");
    const series = chart.series.find((item) => item.label === "long-range-model");

    expect(chart.data.length).toBeLessThanOrEqual(90);
    expect(chart.data.reduce((sum, point) => sum + Number(point[series.id] || 0), 0)).toBe(40);
  });
});
