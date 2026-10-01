// Benchmark: SQLite vs lowdb on equivalent workloads.
// Run: cd app/tests && npm test -- db-benchmark
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, beforeAll, afterAll, vi } from "vitest";

const N_ITEMS = 500;
const N_QUERIES = 200;

const originalDataDir = process.env.DATA_DIR;
let tempSqlite, tempLowdb;
let sqliteDb, lowDb;

function fmt(ms) { return `${ms.toFixed(2)}ms`; }

async function bench(label, fn) {
  // warmup
  await fn();
  const t0 = performance.now();
  await fn();
  const dt = performance.now() - t0;
  console.log(`  ${label.padEnd(40)} ${fmt(dt)}`);
  return dt;
}

beforeAll(async () => {
  // SQLite setup
  tempSqlite = fs.mkdtempSync(path.join(os.tmpdir(), "9router-bench-sqlite-"));
  process.env.DATA_DIR = tempSqlite;
  vi.resetModules();
  sqliteDb = await import("@/lib/db/index.js");
  await sqliteDb.initDb();

  // Lowdb setup — direct lowdb usage (mimics legacy behavior)
  tempLowdb = fs.mkdtempSync(path.join(os.tmpdir(), "9router-bench-lowdb-"));
  const { Low } = await import("lowdb");
  const { JSONFile } = await import("lowdb/node");
  const dbFile = path.join(tempLowdb, "db.json");
  fs.writeFileSync(dbFile, JSON.stringify({ providerConnections: [], usageHistory: [] }));
  lowDb = new Low(new JSONFile(dbFile), { providerConnections: [], usageHistory: [] });
  await lowDb.read();
});

afterAll(() => {
  if (tempSqlite) fs.rmSync(tempSqlite, { recursive: true, force: true });
  if (tempLowdb) fs.rmSync(tempLowdb, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("DB Benchmark — SQLite vs Lowdb", () => {
  it(`INSERT ${N_ITEMS} provider connections`, async () => {
    console.log(`\n[INSERT ${N_ITEMS}]`);

    const sqliteTime = await bench("SQLite createProviderConnection", async () => {
      for (let i = 0; i < N_ITEMS; i++) {
        await sqliteDb.createProviderConnection({
          provider: `bench-p${i % 5}`, authType: "apikey",
          name: `name-${i}`, apiKey: `k-${i}`,
        });
      }
    });

    const lowdbTime = await bench("Lowdb push + write", async () => {
      for (let i = 0; i < N_ITEMS; i++) {
        lowDb.data.providerConnections.push({
          id: `id-${i}`, provider: `bench-p${i % 5}`, authType: "apikey",
          name: `name-${i}`, apiKey: `k-${i}`, priority: i + 1, isActive: true,
          createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        });
        await lowDb.write();
      }
    });

    const speedup = (lowdbTime / sqliteTime).toFixed(2);
    console.log(`  → SQLite is ${speedup}x faster`);
  }, 60000);

  it(`READ ${N_QUERIES} filtered queries`, async () => {
    console.log(`\n[READ ${N_QUERIES} filtered queries]`);

    const sqliteTime = await bench("SQLite getProviderConnections(filter)", async () => {
      for (let i = 0; i < N_QUERIES; i++) {
        await sqliteDb.getProviderConnections({ provider: `bench-p${i % 5}` });
      }
    });

    const lowdbTime = await bench("Lowdb read + filter", async () => {
      for (let i = 0; i < N_QUERIES; i++) {
        await lowDb.read();
        lowDb.data.providerConnections.filter((c) => c.provider === `bench-p${i % 5}`);
      }
    });

    const speedup = (lowdbTime / sqliteTime).toFixed(2);
    console.log(`  → SQLite is ${speedup}x faster`);
  }, 60000);

  it(`READ ${N_QUERIES} by id (point lookup)`, async () => {
    console.log(`\n[READ ${N_QUERIES} by id]`);

    const sqliteAll = await sqliteDb.getProviderConnections();
    const ids = sqliteAll.slice(0, N_QUERIES).map((c) => c.id);

    const sqliteTime = await bench("SQLite getProviderConnectionById", async () => {
      for (const id of ids) await sqliteDb.getProviderConnectionById(id);
    });

    const lowdbIds = lowDb.data.providerConnections.slice(0, N_QUERIES).map((c) => c.id);
    const lowdbTime = await bench("Lowdb find by id", async () => {
      for (const id of lowdbIds) {
        await lowDb.read();
        lowDb.data.providerConnections.find((c) => c.id === id);
      }
    });

    const speedup = (lowdbTime / sqliteTime).toFixed(2);
    console.log(`  → SQLite is ${speedup}x faster`);
  }, 60000);

  it(`saveRequestUsage ${N_ITEMS} entries`, async () => {
    console.log(`\n[saveRequestUsage ${N_ITEMS}]`);

    const sqliteTime = await bench("SQLite saveRequestUsage", async () => {
      for (let i = 0; i < N_ITEMS; i++) {
        await sqliteDb.saveRequestUsage({
          provider: "openai", model: `m-${i % 10}`, connectionId: `c-${i % 5}`,
          tokens: { prompt_tokens: 100 + i, completion_tokens: 50 + i },
          endpoint: "/v1/chat/completions", status: "ok",
        });
      }
    });

    const lowdbTime = await bench("Lowdb push history + write", async () => {
      lowDb.data.usageHistory = [];
      for (let i = 0; i < N_ITEMS; i++) {
        lowDb.data.usageHistory.push({
          timestamp: new Date().toISOString(), provider: "openai", model: `m-${i % 10}`,
          connectionId: `c-${i % 5}`, tokens: { prompt_tokens: 100 + i, completion_tokens: 50 + i },
          endpoint: "/v1/chat/completions", status: "ok", cost: 0,
        });
        await lowDb.write();
      }
    });

    const speedup = (lowdbTime / sqliteTime).toFixed(2);
    console.log(`  → SQLite is ${speedup}x faster`);
  }, 120000);

  it(`getUsageStats(24h) repeat 50x`, async () => {
    console.log(`\n[getUsageStats(24h) x 50]`);

    const sqliteTime = await bench("SQLite getUsageStats(24h)", async () => {
      for (let i = 0; i < 50; i++) await sqliteDb.getUsageStats("24h");
    });

    const lowdbTime = await bench("Lowdb read + aggregate", async () => {
      for (let i = 0; i < 50; i++) {
        await lowDb.read();
        const cutoff = Date.now() - 86400000;
        const hist = lowDb.data.usageHistory.filter((h) => new Date(h.timestamp).getTime() >= cutoff);
        const stats = { byProvider: {}, byModel: {} };
        for (const e of hist) {
          if (!stats.byProvider[e.provider]) stats.byProvider[e.provider] = { requests: 0 };
          stats.byProvider[e.provider].requests++;
        }
      }
    });

    const speedup = (lowdbTime / sqliteTime).toFixed(2);
    console.log(`  → SQLite is ${speedup}x faster`);
  }, 60000);
});
