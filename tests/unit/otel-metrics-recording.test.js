// Per-key usage/cost metrics recorded from saveRequestUsage /
// saveUsageStats, read back through the Prometheus serialisation the /metrics route serves.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const ENV_KEYS = [
  "DATA_DIR",
  "OBSERVABILITY_METRICS_ENDPOINT_ENABLED",
  "OBSERVABILITY_METRICS_ENDPOINT_PASSWORD",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_METRICS_ENDPOINT",
  "OTEL_METRICS_EXPORTER",
];

let tempDir;
let db;
let metrics;

async function load() {
  vi.resetModules();
  metrics = await import("@/lib/observability/metrics.js");
  await metrics.__resetMetricsForTests();
  db = await import("@/lib/db/index.js");
  await db.initDb();
}

function sample(text, name, labels) {
  // Find the line for `name` whose label set contains every given label.
  const lines = text.split("\n").filter((l) => l.startsWith(name + "{"));
  const hit = lines.find((l) => Object.entries(labels).every(([k, v]) => l.includes(`${k}="${v}"`)));
  return hit ? Number(hit.slice(hit.lastIndexOf(" ") + 1)) : undefined;
}

beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-metrics-"));
  process.env.DATA_DIR = tempDir;
});

// The DB adapter is a process-wide global (src/lib/db/driver.js), so DATA_DIR only takes
// effect for the first test in this file: assertions on usage history are deltas.
afterEach(async () => {
  if (metrics) await metrics.__resetMetricsForTests();
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("metrics disabled (nothing configured)", () => {
  it("creates no provider and saveRequestUsage behaves as before", async () => {
    await load();
    expect(metrics.getMetrics()).toBeNull();
    const before = (await db.getUsageHistory({})).length;
    await db.saveRequestUsage({
      provider: "openai", model: "m", tokens: { prompt_tokens: 3, completion_tokens: 4 }, endpoint: "/v1/chat/completions",
    });
    expect((await db.getUsageHistory({})).length).toBe(before + 1);
    expect(await metrics.collectPrometheusText()).toBeNull();
  });
});

describe("metrics enabled (Prometheus endpoint)", () => {
  beforeEach(async () => {
    process.env.OBSERVABILITY_METRICS_ENDPOINT_ENABLED = "true";
    await load();
  });

  it("records requests, tokens and cost per key name, never the key value", async () => {
    await db.updatePricing({ openai: { "price-model": { input: 1, output: 2 } } });
    const key = await db.createApiKey("team-alpha", "machine-1");

    await db.saveRequestUsage({
      provider: "openai",
      model: "price-model",
      apiKey: key.key,
      endpoint: "/v1/chat/completions",
      tokens: {
        prompt_tokens: 1000, completion_tokens: 500, cached_tokens: 200,
        reasoning_tokens: 50, cache_creation_input_tokens: 100, total_tokens: 1500,
      },
    });

    const text = await metrics.collectPrometheusText();
    expect(text).not.toContain(key.key);

    const base = { key_name: "team-alpha", model: "price-model", provider: "openai", endpoint: "/v1/chat/completions", status: "ok" };
    expect(sample(text, "ninerouter_requests_total", base)).toBe(1);
    expect(sample(text, "ninerouter_tokens_total", { ...base, type: "prompt" })).toBe(1000);
    expect(sample(text, "ninerouter_tokens_total", { ...base, type: "completion" })).toBe(500);
    expect(sample(text, "ninerouter_tokens_total", { ...base, type: "cached" })).toBe(200);
    expect(sample(text, "ninerouter_tokens_total", { ...base, type: "reasoning" })).toBe(50);
    expect(sample(text, "ninerouter_tokens_total", { ...base, type: "cache_creation" })).toBe(100);

    const costLine = text.split("\n").find((l) => /^ninerouter_cost\w*\{/.test(l) && l.includes('key_name="team-alpha"'));
    expect(costLine).toBeDefined();
    const cost = Number(costLine.slice(costLine.lastIndexOf(" ") + 1));
    // (1000-200-100)*1 + 200*1 + 500*2 + 50*2 + 100*1, per million
    expect(cost).toBeCloseTo(0.0021, 9);
  });

  it("labels a request without a key 'no-key' and an unknown key 'unknown-key'", async () => {
    await db.saveRequestUsage({ provider: "p", model: "m", endpoint: "/v1/x", tokens: { prompt_tokens: 1, completion_tokens: 1 } });
    await db.saveRequestUsage({ provider: "p", model: "m", endpoint: "/v1/x", apiKey: "sk-not-in-db-123456", tokens: { prompt_tokens: 2, completion_tokens: 2 } });
    const text = await metrics.collectPrometheusText();
    expect(sample(text, "ninerouter_requests_total", { key_name: "no-key" })).toBe(1);
    expect(sample(text, "ninerouter_requests_total", { key_name: "unknown-key" })).toBe(1);
    expect(text).not.toContain("sk-not-in-db-123456");
  });

  it("does not double-count a duplicate usage row", async () => {
    const entry = { provider: "p", model: "m", endpoint: "/v1/x", timestamp: new Date().toISOString(), tokens: { prompt_tokens: 5, completion_tokens: 5 } };
    await db.saveRequestUsage({ ...entry });
    await db.saveRequestUsage({ ...entry });
    const text = await metrics.collectPrometheusText();
    expect(sample(text, "ninerouter_requests_total", { key_name: "no-key", model: "m" })).toBe(1);
  });

  it("counts empty and usage-less requests from saveUsageStats with zero tokens", async () => {
    const { saveUsageStats } = await import("open-sse/handlers/chatCore/requestDetail.js");
    const key = await db.createApiKey("team-beta", "machine-1");
    const before = (await db.getUsageHistory({})).length;
    saveUsageStats({ provider: "gemini", model: "g", tokens: { prompt_tokens: 0, completion_tokens: 0 }, apiKey: key.key, endpoint: "/v1/messages", silent: true });
    saveUsageStats({ provider: "gemini", model: "g", tokens: null, apiKey: key.key, endpoint: "/v1/messages", silent: true });
    await metrics.__flushPendingForTests();
    const text = await metrics.collectPrometheusText();
    const base = { key_name: "team-beta", provider: "gemini", model: "g", endpoint: "/v1/messages" };
    expect(sample(text, "ninerouter_requests_total", { ...base, status: "empty" })).toBe(1);
    expect(sample(text, "ninerouter_requests_total", { ...base, status: "no_usage" })).toBe(1);
    expect(text).not.toMatch(/ninerouter_tokens_total\{[^}]*key_name="team-beta"/);
    // Nothing was written to usage history for them (upstream behaviour unchanged).
    expect((await db.getUsageHistory({})).length).toBe(before);
  });

  it("counts provider failures with status error (or aborted) and zero tokens", async () => {
    const key = await db.createApiKey("team-gamma", "machine-1");
    const base = { key_name: "team-gamma", provider: "openai", model: "m", endpoint: "/v1/chat/completions" };
    metrics.recordFailedRequestMetrics({ provider: "openai", model: "m", apiKey: key.key, endpoint: "/v1/chat/completions?x=1", statusCode: 503 });
    metrics.recordFailedRequestMetrics({ provider: "openai", model: "m", apiKey: key.key, endpoint: "/v1/chat/completions", statusCode: 429 });
    metrics.recordFailedRequestMetrics({ provider: "openai", model: "m", apiKey: key.key, endpoint: "/v1/chat/completions", statusCode: 499 });
    await metrics.__flushPendingForTests();
    const text = await metrics.collectPrometheusText();
    expect(sample(text, "ninerouter_requests_total", { ...base, status: "error" })).toBe(2);
    expect(sample(text, "ninerouter_requests_total", { ...base, status: "aborted" })).toBe(1);
    expect(text).not.toMatch(/ninerouter_tokens_total\{[^}]*key_name="team-gamma"/);
    expect(text).not.toContain(key.key);
  });

  it("names the cost metric ninerouter_cost_usd_total", async () => {
    await db.saveRequestUsage({ provider: "openai", model: "price-model", endpoint: "/v1/x", tokens: { prompt_tokens: 1000, completion_tokens: 0 } });
    const text = await metrics.collectPrometheusText();
    expect(text).toMatch(/^ninerouter_cost_usd_total\{/m);
  });

  it("publishes ninerouter.key.limit.used_ratio per limited key from the real spend, nothing for unlimited keys", async () => {
    await db.updatePricing({ openai: { "gauge-model": { input: 1000, output: 0 } } });
    const limited = await db.createApiKey("team-limited", "machine-1");
    await db.updateApiKey(limited.id, { limit: { usd: 4, window: "day" } });
    const monthly = await db.createApiKey("team-monthly", "machine-1");
    await db.updateApiKey(monthly.id, { limit: { usd: 10, window: "month" } });
    const free = await db.createApiKey("team-free", "machine-1");
    // 1000 prompt tokens at 1000 USD per million = 1 USD
    for (const k of [limited, free]) {
      await db.saveRequestUsage({ provider: "openai", model: "gauge-model", apiKey: k.key, endpoint: "/v1/x", tokens: { prompt_tokens: 1000, completion_tokens: 0 } });
    }
    const text = await metrics.collectPrometheusText();
    const line = (name) => text.split("\n").find((l) => /^ninerouter_key_limit_used_ratio\w*\{/.test(l) && l.includes(`key_name="${name}"`));
    const value = (l) => Number(l.slice(l.lastIndexOf(" ") + 1));
    expect(line("team-limited")).toContain('window="day"');
    expect(value(line("team-limited"))).toBeCloseTo(0.25, 9);
    expect(line("team-monthly")).toContain('window="month"');
    expect(value(line("team-monthly"))).toBe(0);
    expect(line("team-free")).toBeUndefined();
    expect(text).not.toContain(limited.key);
  });

  it("a limited key that is removed, or whose spend read fails, goes NaN on the next scrape, never keeps its old ratio", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const svc = await import("@/sse/services/keySpendLimit.js");
      const usageRepo = await import("@/lib/db/repos/usageRepo.js");
      await db.updatePricing({ openai: { "stale-model": { input: 1000, output: 0 } } });
      const gone = await db.createApiKey("team-stale-gone", "machine-1");
      const flaky = await db.createApiKey("team-stale-flaky", "machine-1");
      const kept = await db.createApiKey("team-stale-kept", "machine-1");
      for (const k of [gone, flaky, kept]) {
        await db.updateApiKey(k.id, { limit: { usd: 4, window: "day" } });
        await db.saveRequestUsage({ provider: "openai", model: "stale-model", apiKey: k.key, endpoint: "/v1/x", tokens: { prompt_tokens: 3800, completion_tokens: 0 } });
      }
      const ratio = (text, name) => sample(text, "ninerouter_key_limit_used_ratio", { key_name: name });

      const first = await metrics.collectPrometheusText();
      for (const name of ["team-stale-gone", "team-stale-flaky", "team-stale-kept"]) expect(ratio(first, name)).toBeCloseTo(0.95, 9);

      await db.deleteApiKey(gone.id);
      svc.resetSpendCache();
      const realSpend = usageRepo.getKeySpendSince;
      vi.spyOn(usageRepo, "getKeySpendSince").mockImplementation(async (keyValue, since) => {
        if (keyValue === flaky.key) throw new Error("db locked");
        return realSpend(keyValue, since);
      });
      const second = await metrics.collectPrometheusText();
      expect(ratio(second, "team-stale-gone")).toBeNaN();
      expect(ratio(second, "team-stale-flaky")).toBeNaN();
      expect(ratio(second, "team-stale-kept")).toBeCloseTo(0.95, 9);

      svc.resetSpendCache();
      const third = await metrics.collectPrometheusText();
      for (const name of ["team-stale-gone", "team-stale-flaky"]) {
        const v = ratio(third, name);
        expect(v === undefined || Number.isNaN(v)).toBe(true);
      }
      expect(ratio(third, "team-stale-kept")).toBeCloseTo(0.95, 9);
    } finally {
      vi.restoreAllMocks();
      warn.mockRestore();
    }
  });

  it("counts refusals in ninerouter.key.limit.refused per key_name and window", async () => {
    metrics.recordKeyLimitRefused({ keyName: "team-capped", window: "day" });
    metrics.recordKeyLimitRefused({ keyName: "team-capped", window: "day" });
    const text = await metrics.collectPrometheusText();
    const l = text.split("\n").find((x) => /^ninerouter_key_limit_refused\w*\{/.test(x) && x.includes('key_name="team-capped"'));
    expect(l).toContain('window="day"');
    expect(Number(l.slice(l.lastIndexOf(" ") + 1))).toBe(2);
  });

  it("recordFailedRequestMetrics never throws, even with no arguments", () => {
    expect(() => metrics.recordFailedRequestMetrics()).not.toThrow();
  });

  it("a metrics failure never breaks saveRequestUsage", async () => {
    const state = metrics.getMetrics();
    state.requests.add = () => { throw new Error("boom"); };
    const before = (await db.getUsageHistory({})).length;
    await db.saveRequestUsage({ provider: "p", model: "m", endpoint: "/v1/x", tokens: { prompt_tokens: 1, completion_tokens: 1 } });
    expect((await db.getUsageHistory({})).length).toBe(before + 1);
  });
});

describe("/metrics route", () => {
  async function get(headers = {}) {
    const { GET } = await import("@/app/metrics/route.js");
    return GET(new Request("http://localhost/metrics", { headers }));
  }

  it("returns 404 when the endpoint is disabled", async () => {
    await load();
    const res = await get();
    expect(res.status).toBe(404);
  });

  it("returns 200 Prometheus text with no password", async () => {
    process.env.OBSERVABILITY_METRICS_ENDPOINT_ENABLED = "true";
    await load();
    await db.saveRequestUsage({ provider: "p", model: "m", endpoint: "/v1/x", tokens: { prompt_tokens: 1, completion_tokens: 1 } });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await res.text()).toContain("ninerouter_requests_total");
  });

  it("enforces the password with Bearer or Basic", async () => {
    process.env.OBSERVABILITY_METRICS_ENDPOINT_ENABLED = "true";
    process.env.OBSERVABILITY_METRICS_ENDPOINT_PASSWORD = "test-pw";
    await load();
    const none = await get();
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toMatch(/^Basic/);
    expect((await get({ authorization: "Bearer wrong" })).status).toBe(401);
    expect((await get({ authorization: "Bearer test-pw" })).status).toBe(200);
    const b = "Basic " + Buffer.from("prom:test-pw").toString("base64");
    expect((await get({ authorization: b })).status).toBe(200);
  });
});
