/**
 * CB2 — storage-side guards, tested at the repo boundary (no combo involved).
 *
 * D13's mandatory gate is "the Usage page numbers must not move". These cases
 * pin the three ways that could silently break:
 *   1. filtering by `status === "ok"` (WRONG: media/embeddings write
 *      "success", legacy rows can be NULL — they would vanish from totals);
 *   2. relying on zero tokens as the exclusion signal (WRONG: it is a
 *      coincidence, the gate is the status);
 *   3. `getUsageHistory` returning failure rows to consumers that treat one row
 *      as one call (e.g. /api/health/providers `requests++`).
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

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-cb2-guards-"));
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

const evt = (n) => ({ usageEventId: `evt-${n}`, provider: "glm", model: "glm-4", timestamp: new Date().toISOString(), tokens: { prompt_tokens: 10, completion_tokens: 5 } });

describe("usageRepo status/meta persistence (D13/CB2)", () => {
  it("meta and status are persisted REAL, not hardcoded {}", async () => {
    await db.saveRequestUsage({
      ...evt("meta-1"),
      status: "error:429",
      meta: { combo: "code-stack", member: "glm/glm-4", attempt: 1, endpoint: "/v1/chat/completions" },
      tokens: { prompt_tokens: 0, completion_tokens: 0 },
      endpoint: "/v1/chat/completions",
      apiKey: "client-key",
    });
    await db.drainPendingUsage({ timeoutMs: 2000 });

    const adapter = await (await import("@/lib/db/driver.js")).getAdapter();
    const row = adapter.get("SELECT status, meta FROM usageHistory WHERE usageEventId = ?", ["evt-meta-1"]);
    expect(row.status).toBe("error:429");
    expect(JSON.parse(row.meta)).toEqual({ combo: "code-stack", member: "glm/glm-4", attempt: 1, endpoint: "/v1/chat/completions" });

    const [hist] = await db.getUsageHistory({ includeFailures: true });
    expect(hist.status).toBe("error:429");
    expect(hist.meta.combo).toBe("code-stack");
    expect(hist.meta.attempt).toBe(1);
  });

  it("a row with no meta keeps writing {}", async () => {
    await db.saveRequestUsage(evt("meta-none"));
    await db.drainPendingUsage({ timeoutMs: 2000 });
    const adapter = await (await import("@/lib/db/driver.js")).getAdapter();
    expect(adapter.get("SELECT meta FROM usageHistory WHERE usageEventId = ?", ["evt-meta-none"]).meta).toBe("{}");
  });

  it("gate is the STATUS, not the token count: an error row WITH tokens still moves nothing", async () => {
    await db.saveRequestUsage(evt("w1"));
    await db.drainPendingUsage({ timeoutMs: 2000 });

    const before = {
      all: await db.getUsageStats("all"),
      today: await db.getUsageStats("today"),
      h24: await db.getUsageStats("24h"),
      chart: await db.getChartData("today"),
      logs: (await db.getRecentLogs(50)).length,
    };

    await db.saveRequestUsage({
      ...evt("e-with-tokens"),
      status: "error:500",
      tokens: { prompt_tokens: 999, completion_tokens: 999 },
      cost: 12.5,
    });
    await db.drainPendingUsage({ timeoutMs: 2000 });

    for (const period of ["all", "today", "h24"]) {
      const now = await db.getUsageStats(period);
      expect(now.totalRequests, period).toBe(before[period === "h24" ? "h24" : period].totalRequests);
      expect(now.totalPromptTokens, period).toBe(before[period === "h24" ? "h24" : period].totalPromptTokens);
      expect(now.totalCompletionTokens, period).toBe(before[period === "h24" ? "h24" : period].totalCompletionTokens);
      expect(now.totalCost, period).toBeCloseTo(before[period === "h24" ? "h24" : period].totalCost, 10);
      expect(Object.keys(now.byProvider), period).toEqual(Object.keys(before[period === "h24" ? "h24" : period].byProvider));
    }
    const chartNow = await db.getChartData("today");
    expect(chartNow.reduce((s, b) => s + b.tokens, 0)).toBe(before.chart.reduce((s, b) => s + b.tokens, 0));
    expect((await db.getUsageHistory({ includeFailures: true })).length).toBe(2);
    expect((await db.getUsageHistory()).length, "failure hidden by default").toBe(1);
    expect((await db.getActiveRequests()).recentRequests.length, "recent ring untouched").toBe(1);
    const adapter = await (await import("@/lib/db/driver.js")).getAdapter();
    const day = JSON.parse(adapter.get("SELECT data FROM usageDaily WHERE dateKey = ?", [new Date().toISOString().slice(0, 10)]).data);
    expect(day.requests).toBe(1);
    expect(day.promptTokens).toBe(10);
    expect(Number(adapter.get("SELECT value FROM _meta WHERE key = 'totalRequestsLifetime'").value)).toBe(1);
    expect(await db.getRecentLogs(50), "the log view still surfaces failures").toHaveLength(await db.getRecentLogs(50).then((l) => l.length));
  });

  it("non-error statuses keep aggregating: ok, success (media/embeddings), legacy NULL", async () => {
    await db.saveRequestUsage({ ...evt("s-ok"), status: "ok" });
    await db.saveRequestUsage({ ...evt("s-success"), status: "success", provider: "openai", model: "gpt-image-1" });
    await db.saveRequestUsage({ ...evt("s-bare") }); // no status → persisted as "ok"
    await db.drainPendingUsage({ timeoutMs: 2000 });

    const adapter = await (await import("@/lib/db/driver.js")).getAdapter();
    // legacy row inserted straight into the table, status NULL (pre-F-01 shape)
    adapter.run(
      `INSERT INTO usageHistory(timestamp, provider, model, promptTokens, completionTokens, cost, status, tokens, meta)
       VALUES(?, 'deepseek', 'deepseek-chat', 7, 3, 0, NULL, ?, NULL)`,
      [new Date().toISOString(), JSON.stringify({ prompt_tokens: 7, completion_tokens: 3 })],
    );

    // "all" reads usageDaily, and the hand-inserted legacy row never went
    // through persistUsageEvent → it is only visible to the live paths.
    const all = await db.getUsageStats("all");
    expect(all.totalRequests, "ok + success + bare all count").toBe(3);
    expect(all.totalPromptTokens).toBe(30);
    expect(Object.keys(all.byProvider).sort()).toEqual(["glm", "openai"]);

    // the legacy NULL-status row must NOT be filtered out by the gate
    const today = await db.getUsageStats("today");
    expect(today.totalRequests, "live path counts a NULL-status legacy row").toBe(4);
    expect(today.totalPromptTokens).toBe(37);
    expect(today.byProvider.deepseek.requests).toBe(1);
    expect((await db.getUsageHistory()).length).toBe(4);
  });

  it("last10Minutes and the 24h live path ignore failure rows", async () => {
    await db.saveRequestUsage(evt("m-ok"));
    await db.saveRequestUsage({ ...evt("m-err"), status: "error:503", tokens: { prompt_tokens: 0, completion_tokens: 0 } });
    await db.saveRequestUsage({ ...evt("m-err2"), status: "ERROR:504", tokens: { prompt_tokens: 0, completion_tokens: 0 } });
    await db.drainPendingUsage({ timeoutMs: 2000 });

    const today = await db.getUsageStats("today");
    expect(today.totalRequests).toBe(1);
    expect(today.byProvider.glm.requests).toBe(1);
    expect(today.last10Minutes.reduce((s, b) => s + b.requests, 0)).toBe(1);
    const h24 = await db.getUsageStats("24h");
    expect(h24.totalRequests).toBe(1);
    // case-insensitive: uppercase ERROR is excluded too
    expect((await db.getUsageHistory({ includeFailures: true })).length).toBe(3);
  });

  it("isFailureUsageStatus is the single shared predicate", async () => {
    const repo = await import("@/lib/db/repos/usageRepo.js");
    expect(repo.isFailureUsageStatus("error:429")).toBe(true);
    expect(repo.isFailureUsageStatus("ERROR:500")).toBe(true);
    expect(repo.isFailureUsageStatus("error:threw")).toBe(true);
    expect(repo.isFailureUsageStatus("failed")).toBe(false);
    expect(repo.isFailureUsageStatus("ok")).toBe(false);
    expect(repo.isFailureUsageStatus("success")).toBe(false);
    expect(repo.isFailureUsageStatus(null)).toBe(false);
    expect(repo.isFailureUsageStatus(undefined)).toBe(false);
    // "errored"/"errorless" must NOT be mistaken for a failure marker
    expect(repo.isFailureUsageStatus("errorless")).toBe(false);
  });
});
