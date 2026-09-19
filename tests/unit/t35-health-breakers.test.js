// T3.5 — health matrix, breaker/lock plane.
//
// Covers the two rules the task pins:
//   • a tripped breaker must appear in the matrix (and it is evidence, so it
//     outranks the no-traffic "unknown" rule)
//   • breaker attribution uses the F24c segment-boundary rule, so the account
//     `p:conn-1` can never read `p:conn-10:*` as its own
// No action is ever taken: nothing here resets a breaker or clears a lock.
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

const PROVIDER = "t35-brk";

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

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-t35-brk-"));
  process.env.DATA_DIR = tempDir;
  resetDbState();
  const db = await import("@/lib/db/index.js");
  await db.initDb();
});

afterEach(() => {
  resetDbState();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

async function seedConnection({ id, provider = PROVIDER, data = {} }) {
  const { getAdapter } = await import("@/lib/db/driver.js");
  const db = await getAdapter();
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
     VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, provider, "apikey", id, null, 1, 1, JSON.stringify({ apiKey: "sk-test", ...data }), now, now],
  );
}

/** Drive a breaker to a state through the breaker module's own public API. */
async function drive(name, { failures, successes = 0 }) {
  const cb = await import("open-sse/utils/circuitBreaker.js");
  cb.getCircuitBreaker(name, {
    failureThreshold: failures,
    resetTimeout: 60_000,
    failureWindowMs: 0, // cumulative: the state cannot drift mid-assertion
    halfOpenRequests: 1,
  });
  for (let i = 0; i < successes; i++) cb.recordSuccess(name);
  for (let i = 0; i < failures; i++) cb.recordFailure(name, { statusCode: 503 });
  return cb;
}

async function matrix(range = "24h") {
  const { createDashboardAuthToken } = await import("@/lib/auth/dashboardSession");
  const { GET } = await import("@/app/api/health/providers/route.js");
  const jwt = await createDashboardAuthToken({});
  const request = {
    url: `http://localhost/api/health/providers?range=${range}`,
    cookies: { get: (n) => (n === "auth_token" ? { value: jwt } : undefined) },
  };
  const res = await GET(request);
  return { status: res.status, body: await res.json() };
}

describe("t35 matrix — circuit breakers", () => {
  it("an OPEN breaker surfaces on the provider, the connection and the model", async () => {
    await seedConnection({ id: "conn-open", provider: PROVIDER });
    const cb = await drive(`${PROVIDER}:conn-open:gpt-tripped`, { failures: 2 });
    expect(cb.getAllCircuitBreakerStatuses().find((b) => b.name === `${PROVIDER}:conn-open:gpt-tripped`).state).toBe("OPEN");

    const { body } = await matrix();
    const prov = body.providers.find((p) => p.provider === PROVIDER);
    expect(prov.breaker).toBeTruthy();
    expect(prov.breaker.state).toBe("OPEN");
    expect(prov.breaker.retryAfterMs).toBeGreaterThan(0);
    expect(prov.breaker.models).toEqual(["gpt-tripped"]);
    // zero traffic, but a tripped breaker is real evidence → not "unknown"
    expect(prov.requests).toBe(0);
    expect(prov.status).toBe("down");
    expect(prov.reasons).toContain("circuit:OPEN");

    const conn = prov.connections.find((c) => c.id === "conn-open");
    expect(conn.breaker.state).toBe("OPEN");

    const cell = prov.models.find((m) => m.model === "gpt-tripped");
    expect(cell).toBeTruthy();
    expect(cell.breakerState).toBe("OPEN");
    expect(cell.status).toBe("down");
    // the matrix is honest about where the breaker evidence comes from
    expect(body.sources.breaker).toMatch(/NOT range-scoped/);
  });

  it("a DEGRADED breaker reads degraded, not down", async () => {
    await seedConnection({ id: "conn-degr", provider: "t35-degr" });
    const cb = await import("open-sse/utils/circuitBreaker.js");
    const name = "t35-degr:conn-degr:gpt-soft";
    cb.getCircuitBreaker(name, {
      failureThreshold: 10,
      degradationThreshold: 1,
      resetTimeout: 60_000,
      failureWindowMs: 0,
    });
    cb.recordFailure(name, { statusCode: 500 });
    expect(cb.getAllCircuitBreakerStatuses().find((b) => b.name === name).state).toBe(cb.STATE.DEGRADED);

    const { body } = await matrix();
    const prov = body.providers.find((p) => p.provider === "t35-degr");
    expect(prov.status).toBe("degraded");
    expect(prov.reasons).toContain("circuit:DEGRADED");
  });

  it("the account prefix never leaks onto a sibling connection (conn-1 vs conn-10)", async () => {
    await seedConnection({ id: "conn-1", provider: "t35-sib" });
    await seedConnection({ id: "conn-10", provider: "t35-sib" });
    await drive("t35-sib:conn-1:gpt-a", { failures: 2 });
    await drive("t35-sib:conn-10:gpt-b", { failures: 3 });

    const { body } = await matrix();
    const prov = body.providers.find((p) => p.provider === "t35-sib");
    const c1 = prov.connections.find((c) => c.id === "conn-1");
    const c10 = prov.connections.find((c) => c.id === "conn-10");

    expect(c1.breaker.models).toEqual(["gpt-a"]);
    expect(c10.breaker.models).toEqual(["gpt-b"]);
    // each account reports only its own failure tally
    expect(c1.breaker.failureCount).toBe(2);
    expect(c10.breaker.failureCount).toBe(3);
    // both tripped models stay distinct cells in the matrix
    const names = prov.models.map((m) => m.model).sort();
    expect(names).toEqual(["gpt-a", "gpt-b"]);
    expect(prov.models.find((m) => m.model === "gpt-a").breakerState).toBe("OPEN");
    expect(prov.models.find((m) => m.model === "gpt-b").breakerState).toBe("OPEN");
    expect(prov.breaker.models.sort()).toEqual(["gpt-a", "gpt-b"]);
  });

  it("a model id carrying a colon keeps its full name (segmentation is positional)", async () => {
    await seedConnection({ id: "conn-colon", provider: "t35-colon" });
    await drive("t35-colon:conn-colon:gemini-2.5-flash:free", { failures: 2 });

    const { body } = await matrix();
    const prov = body.providers.find((p) => p.provider === "t35-colon");
    expect(prov.breaker.models).toEqual(["gemini-2.5-flash:free"]);
    expect(prov.models.map((m) => m.model)).toEqual(["gemini-2.5-flash:free"]);
  });

  it("a breaker whose connection is gone is still reported (provider segment)", async () => {
    await drive("t35-orphan:conn-gone:gpt-x", { failures: 2 });
    const { body } = await matrix();
    const prov = body.providers.find((p) => p.provider === "t35-orphan");
    expect(prov).toBeTruthy();
    expect(prov.connectionCount).toBe(0);
    expect(prov.status).toBe("down");
    expect(prov.models.find((m) => m.model === "gpt-x").breakerState).toBe("OPEN");
  });
});

describe("t35 matrix — cooldowns and catalogue", () => {
  it("an active model lock reads cooldown with the locked model named", async () => {
    const until = new Date(Date.now() + 5 * 60_000).toISOString();
    await seedConnection({ id: "conn-lock", provider: "t35-lock", data: { "modelLock_gpt-locked": until } });

    const { body } = await matrix();
    const prov = body.providers.find((p) => p.provider === "t35-lock");
    expect(prov.status).toBe("cooldown");
    expect(prov.reasons).toContain("lock:gpt-locked");
    expect(prov.lockUntil).toBe(until);
    const cell = prov.models.find((m) => m.model === "gpt-locked");
    expect(cell.status).toBe("cooldown");
    // an expired lock is not a cooldown
    expect(prov.connections.find((c) => c.id === "conn-lock").cooldownUntil).toBe(null);
  });

  it("a stale connection catalogue is information, never a health verdict", async () => {
    await seedConnection({
      id: "conn-cat",
      provider: "t35-cat",
      data: {
        modelCatalog: {
          models: [{ id: "m1" }],
          lastSuccessAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
          lastError: "sync failed",
        },
      },
    });

    const { body } = await matrix();
    const prov = body.providers.find((p) => p.provider === "t35-cat");
    expect(prov.catalog.worst).toBe("stale");
    expect(prov.connections[0].catalogStatus).toBe("stale");
    expect(prov.connections[0].catalogModels).toBe(1);
    expect(prov.connections[0].catalogLastError).toBe("sync failed");
    // no traffic at all → unknown, even though the catalogue is stale
    expect(prov.status).toBe("unknown");
  });

  it("exposes no write path: the module exports GET only", async () => {
    const route = await import("@/app/api/health/providers/route.js");
    expect(Object.keys(route).sort()).toEqual(["GET", "dynamic"]);
  });
});
