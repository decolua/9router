// T3.5 — read-only provider × model health matrix (data plane).
//
// Spec anchors (docs/orchestration/OMNIROUTE-DIFF.md §T-E):
//   • aggregates per provider+model over ?range=1h|24h|7d
//   • successRate/avgLatency come from the sources that actually hold them
//     (requestDetails), never invented out of usageHistory's token rows
//   • a provider without traffic is "unknown", NEVER "down"
//   • no synthetic score, no interactive action anywhere
//   • GET /api/health (liveness) stays untouched
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json(body, init = {}) {
      return new Response(JSON.stringify(body), {
        status: init.status || 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  },
}));

const PROVIDER = "t35-alpha";
const IDLE = "t35-idle";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

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
  for (const key of [
    "_dbAdapter", "_pendingRequests", "_lastErrorProvider", "_recentRing",
    "_statsEmitter", "_statsEmitTimers", "_pendingUsagePersists",
  ]) delete global[key];
  vi.resetModules();
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-t35-"));
  process.env.DATA_DIR = tempDir;
  resetDbState();
});

afterEach(() => {
  resetDbState();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString();

/** Insert a connection with a caller-chosen id (uuid is generated otherwise). */
async function seedConnection({ id, provider, data = {} }) {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, provider, "apikey", id, null, 1, 1, JSON.stringify({ apiKey: "sk-test", ...data }), now, now],
  );
}

async function seedUsage({ provider, model, timestamp, connectionId = null, tokens = { prompt_tokens: 1, completion_tokens: 1 } }) {
  const { saveRequestUsage } = await import("@/lib/usageDb");
  await saveRequestUsage({ provider, model, connectionId, timestamp, tokens });
}

async function seedDetail({ provider, model, timestamp, status, total, connectionId = null }) {
  const { saveRequestDetail, flushRequestDetailsNow } = await import("@/lib/usageDb");
  await saveRequestDetail({
    provider,
    model,
    connectionId,
    timestamp,
    status,
    latency: { ttft: Math.round(total / 2), total },
    tokens: { prompt_tokens: 1, completion_tokens: 1 },
    request: { messages: [] },
  });
  await flushRequestDetailsNow();
}

async function matrix({ range, provider, token = "valid" } = {}) {
  const { createDashboardAuthToken } = await import("@/lib/auth/dashboardSession");
  const { GET } = await import("@/app/api/health/providers/route.js");
  const jwt = token === "valid" ? await createDashboardAuthToken({}) : "forged";
  const params = new URLSearchParams();
  if (range) params.set("range", range);
  if (provider) params.set("provider", provider);
  const url = `http://localhost/api/health/providers${params.toString() ? `?${params}` : ""}`;
  const request = { url, cookies: { get: (name) => (name === "auth_token" ? { value: jwt } : undefined) } };
  const res = await GET(request);
  return { status: res.status, body: await res.json() };
}

async function initDb() {
  const db = await import("@/lib/db/index.js");
  await db.initDb();
  return db;
}

describe("t35 matrix — aggregates per range", () => {
  it("counts provider+model requests by window and reports rates/latency from the source that holds them", async () => {
    const db = await initDb();
    // outcomes only exist when requestDetails recording is on (it is off by
    // default — the route has to say so, asserted in the last spec below)
    await db.updateSettings({ enableObservability: true });
    await seedConnection({ id: "c-alpha", provider: PROVIDER });

    // traffic (usageHistory): alpha-mini 3×1h, 1×3h, 1×2d — alpha-big 1×10min, 1×2d
    for (const m of [5, 10, 40]) await seedUsage({ provider: PROVIDER, model: "alpha-mini", timestamp: minutesAgo(m) });
    await seedUsage({ provider: PROVIDER, model: "alpha-mini", timestamp: minutesAgo(180) });
    await seedUsage({ provider: PROVIDER, model: "alpha-mini", timestamp: minutesAgo(2 * 1440) });
    await seedUsage({ provider: PROVIDER, model: "alpha-big", timestamp: minutesAgo(12) });
    await seedUsage({ provider: PROVIDER, model: "alpha-big", timestamp: minutesAgo(2 * 1440) });

    // outcomes (requestDetails): all inside the 1h window, 5 ok + 1 error
    const errAt = minutesAgo(20);
    await seedDetail({ provider: PROVIDER, model: "alpha-mini", timestamp: minutesAgo(30), status: "success", total: 100 });
    await seedDetail({ provider: PROVIDER, model: "alpha-mini", timestamp: minutesAgo(28), status: "success", total: 200 });
    await seedDetail({ provider: PROVIDER, model: "alpha-mini", timestamp: minutesAgo(26), status: "success", total: 300 });
    await seedDetail({ provider: PROVIDER, model: "alpha-mini", timestamp: minutesAgo(24), status: "success", total: 400 });
    await seedDetail({ provider: PROVIDER, model: "alpha-mini", timestamp: errAt, status: "error", total: 500 });
    await seedDetail({ provider: PROVIDER, model: "alpha-big", timestamp: minutesAgo(22), status: "success", total: 600 });

    const oneHour = await matrix({ range: "1h" });
    expect(oneHour.status).toBe(200);
    const alpha = oneHour.body.providers.find((p) => p.provider === PROVIDER);
    expect(alpha).toBeTruthy();
    expect(alpha.requests).toBe(4); // 3 mini + 1 big inside 1h
    expect(alpha.modelsTotal).toBe(2);

    const mini = alpha.models.find((m) => m.model === "alpha-mini");
    expect(mini.requests).toBe(3);
    expect(mini.observed).toBe(5);
    expect(mini.failed).toBe(1);
    expect(mini.successRate).toBeCloseTo(0.8, 5);
    expect(mini.avgLatencyMs).toBe(300); // (100+200+300+400+500)/5
    expect(mini.latencySamples).toBe(5);
    expect(mini.lastErrorAt).toBe(errAt);
    // one failure in five is not a healthy provider, but it is not down either
    expect(mini.status).toBe("degraded");
    expect(alpha.status).toBe("degraded");
    // alpha-big has traffic and one clean sample → ok
    const big = alpha.models.find((m) => m.model === "alpha-big");
    expect(big.status).toBe("ok");
    expect(big.successRate).toBe(1);

    const day = await matrix({ range: "24h" });
    const alphaDay = day.body.providers.find((p) => p.provider === PROVIDER);
    expect(alphaDay.requests).toBe(5); // the 3h-old row joins the window
    const miniDay = alphaDay.models.find((m) => m.model === "alpha-mini");
    expect(miniDay.requests).toBe(4);
    expect(miniDay.observed).toBe(5); // details still all inside the window

    const week = await matrix({ range: "7d" });
    const alphaWeek = week.body.providers.find((p) => p.provider === PROVIDER);
    expect(alphaWeek.requests).toBe(7);
    expect(alphaWeek.models.find((m) => m.model === "alpha-mini").requests).toBe(5);
    expect(alphaWeek.models.find((m) => m.model === "alpha-big").requests).toBe(2);
    expect(week.body.totals.requests).toBe(7);
  });

  it("filters by ?provider= and rejects an unknown range", async () => {
    await initDb();
    await seedConnection({ id: "c-alpha", provider: PROVIDER });
    await seedConnection({ id: "c-idle", provider: IDLE });
    await seedUsage({ provider: PROVIDER, model: "alpha-mini", timestamp: minutesAgo(5) });

    // a breaker under a DIFFERENT provider must not leak through the filter,
    // not even when its connection is gone (those land by name, not by join)
    const cb = await import("open-sse/utils/circuitBreaker.js");
    cb.getCircuitBreaker("t35-other:conn-gone:gpt-x", { failureThreshold: 1, resetTimeout: 60_000, failureWindowMs: 0 });
    cb.recordFailure("t35-other:conn-gone:gpt-x", { statusCode: 503 });

    const filtered = await matrix({ range: "24h", provider: PROVIDER });
    expect(filtered.status).toBe(200);
    expect(filtered.body.providers.map((p) => p.provider)).toEqual([PROVIDER]);
    expect(filtered.body.totals.providers).toBe(1);

    const unfiltered = await matrix({ range: "24h" });
    const other = unfiltered.body.providers.find((p) => p.provider === "t35-other");
    expect(other.status).toBe("down");
    expect(other.connectionCount).toBe(0);

    const bad = await matrix({ range: "1y" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/Invalid range/);
  });
});

describe("t35 matrix — missing data is never called down", () => {
  it("a configured provider with zero traffic is unknown, not down", async () => {
    await initDb();
    await seedConnection({ id: "c-idle", provider: IDLE });

    const res = await matrix({ range: "7d" });
    expect(res.status).toBe(200);
    const idle = res.body.providers.find((p) => p.provider === IDLE);
    expect(idle).toBeTruthy();
    expect(idle.requests).toBe(0);
    expect(idle.observed).toBe(0);
    expect(idle.successRate).toBe(null);
    expect(idle.avgLatencyMs).toBe(null);
    expect(idle.lastErrorAt).toBe(null);
    expect(idle.models).toEqual([]);
    expect(idle.status).toBe("unknown");
    expect(idle.reasons).toContain("no-evidence");
    // catalogue is information, never health: a never-synced catalog keeps unknown
    expect(idle.catalog.worst).toBe("never-synced");
    expect(res.body.totals.unknown).toBe(1);
    expect(res.body.status).toBe("unknown");
  });

  it("traffic without outcome samples reports null rates instead of a fake 100%", async () => {
    await initDb();
    await seedUsage({ provider: PROVIDER, model: "alpha-mini", timestamp: minutesAgo(5) });

    const res = await matrix({ range: "24h" });
    const cell = res.body.providers
      .find((p) => p.provider === PROVIDER)
      .models.find((m) => m.model === "alpha-mini");
    expect(cell.requests).toBe(1);
    expect(cell.observed).toBe(0);
    expect(cell.successRate).toBe(null);
    expect(cell.avgLatencyMs).toBe(null);
    expect(cell.latencySamples).toBe(0);
    // requestDetails is off by default: the payload names that instead of
    // letting the UI render an empty column as a green one
    expect(res.body.sources.outcomesRecorded).toBe(false);
    expect(res.body.sources.outcomesNote).toMatch(/absence of samples, not a healthy fleet/);
  });
});

describe("t35 matrix — auth and liveness isolation", () => {
  it("rejects a forged token and an anonymous caller", async () => {
    await initDb();
    const forged = await matrix({ range: "24h", token: "forged" });
    expect(forged.status).toBe(401);

    const { GET } = await import("@/app/api/health/providers/route.js");
    const anon = await GET({ url: "http://localhost/api/health/providers", cookies: { get: () => undefined } });
    expect(anon.status).toBe(401);
  });

  it("honours requireLogin=false the same way the guard does for every /api route", async () => {
    const db = await initDb();
    await db.updateSettings({ requireLogin: false });
    await seedUsage({ provider: PROVIDER, model: "alpha-mini", timestamp: minutesAgo(5) });

    const { GET } = await import("@/app/api/health/providers/route.js");
    const res = await GET({ url: "http://localhost/api/health/providers?range=24h", cookies: { get: () => undefined } });
    expect(res.status).toBe(200);
  });

  it("leaves GET /api/health (liveness) untouched", async () => {
    await initDb();
    const health = await import("@/app/api/health/route.js");
    const res = await health.GET();
    expect(await res.json()).toEqual({ ok: true });
  });
});
