/**
 * F12 — end-to-end check that a modality usage event actually persists.
 *
 * The mocked handler tests (f12-usage-recording.test.js) prove WHAT is handed
 * to the recorder; this file proves the recorder's payload is consumable by the
 * real storage layer: src/lib/db/repos/usageRepo.js → usageHistory row →
 * getUsageStats/getUsageHistory, with cost derived by the repo's own
 * getPricingForModel lookup (never passed in by the handler).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalDataDir = process.env.DATA_DIR;
let tempDir;
let db;

function resetDbState() {
  const adapter = global._dbAdapter?.instance;
  if (adapter && typeof adapter.close === "function") {
    try { adapter.close(); } catch {}
  }
  if (global._statsEmitter && typeof global._statsEmitter.removeAllListeners === "function") {
    try { global._statsEmitter.removeAllListeners(); } catch {}
  }
  if (global._statsEmitTimers) {
    if (global._statsEmitTimers.update) clearTimeout(global._statsEmitTimers.update);
    if (global._statsEmitTimers.pending) clearTimeout(global._statsEmitTimers.pending);
  }
  for (const key of ["_dbAdapter", "_pendingRequests", "_lastErrorProvider", "_recentRing",
    "_statsEmitter", "_statsEmitTimers", "_pendingUsagePersists"]) {
    delete global[key];
  }
  vi.resetModules();
}

const json = (obj) =>
  new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-f12-usage-"));
  process.env.DATA_DIR = tempDir;
  resetDbState();
  db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterEach(() => {
  resetDbState();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("F12 modality usage events reach usageDb", () => {
  it("stores the row (provider/model/endpoint/tokens) and shows up in the stats", async () => {
    const { recordModalityUsage } = await import("@/sse/utils/mediaUsage.js");

    recordModalityUsage({
      provider: "openai",
      model: "gpt-image-1",
      endpoint: "/v1/images/generations",
      connectionId: "conn-1",
      apiKey: "client-key",
      tokens: { prompt_tokens: 12, completion_tokens: 0 }, // request-side fallback
      response: json({ created: 1, data: [{ url: "https://x/img.png" }], usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } }),
    });

    let history = [];
    await vi.waitFor(async () => {
      history = await db.getUsageHistory();
      expect(history.length).toBe(1);
    }, { timeout: 4000 });

    // upstream usage beat the estimate. getUsageHistory exposes the canonical
    // `tokens` object (see usageRepo.js), not flattened token columns.
    expect(history[0]).toMatchObject({
      provider: "openai",
      model: "gpt-image-1",
      endpoint: "/v1/images/generations",
      connectionId: "conn-1",
      status: "success",
    });
    expect(history[0].tokens).toMatchObject({ prompt_tokens: 100, completion_tokens: 50 });
    expect(history[0].cost).toBeGreaterThanOrEqual(0);

    const stats = await db.getUsageStats("24h");
    expect(stats.totalRequests).toBe(1);
    expect(stats.totalPromptTokens).toBe(100);
    expect(stats.byProvider.openai.requests).toBe(1);
    expect(Object.keys(stats.byEndpoint || {}).some((k) => k.startsWith("/v1/images/generations"))).toBe(true);
  });

  it("prices the event through the repo's own pricing lookup when the model has pricing", async () => {
    const { recordModalityUsage } = await import("@/sse/utils/mediaUsage.js");

    // A priced model id proves the cost hook is the repo's getPricingForModel
    // path — the handler never passes a cost. (Media models have no pricing
    // entry today, which is why the first case only asserts cost >= 0.)
    recordModalityUsage({
      provider: "anthropic",
      model: "claude-haiku-4.5",
      endpoint: "/v1/audio/speech",
      tokens: { prompt_tokens: 1000, completion_tokens: 1000 },
    });

    let history = [];
    await vi.waitFor(async () => {
      history = await db.getUsageHistory();
      expect(history.length).toBe(1);
    }, { timeout: 4000 });

    expect(history[0].cost).toBeGreaterThan(0);
  });

  it("skips an event with nothing countable instead of writing a zero row", async () => {
    const { recordModalityUsage } = await import("@/sse/utils/mediaUsage.js");

    recordModalityUsage({
      provider: "xai", model: "grok-imagine-video", endpoint: "/v1/videos/generations",
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      response: json({ id: "vid-1", status: "queued" }),
    });

    await new Promise((r) => setTimeout(r, 150));
    const history = await db.getUsageHistory();
    expect(history.length).toBe(0);
  });

  it("two events from the same request path stay two independent rows", async () => {
    const { recordModalityUsage } = await import("@/sse/utils/mediaUsage.js");

    recordModalityUsage({ provider: "deepgram", model: "nova-2", endpoint: "/v1/audio/transcriptions", tokens: { prompt_tokens: 5, completion_tokens: 5 } });
    recordModalityUsage({ provider: "deepgram", model: "nova-2", endpoint: "/v1/audio/transcriptions", tokens: { prompt_tokens: 5, completion_tokens: 5 } });

    let history = [];
    await vi.waitFor(async () => {
      history = await db.getUsageHistory();
      expect(history.length).toBe(2);
    }, { timeout: 4000 });
  });
});
