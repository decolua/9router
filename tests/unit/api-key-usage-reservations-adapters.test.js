import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildCreateTableSql, TABLES } from "@/lib/db/schema.js";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
process.setMaxListeners(Math.max(process.getMaxListeners(), 50));
const srcRootUrl = pathToFileURL(`${path.join(repoRoot, "src")}${path.sep}`).href;
const aliasLoader = `data:text/javascript,${encodeURIComponent(`
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) return nextResolve(new URL(specifier.slice(2), ${JSON.stringify(srcRootUrl)}).href, context);
  return nextResolve(specifier, context);
}
`)}`;
const adapterCases = [];

if (!process.versions.bun) {
  try {
    const { createBetterSqliteAdapter } = await import("@/lib/db/adapters/betterSqliteAdapter.js");
    adapterCases.push({ name: "better-sqlite3", create: createBetterSqliteAdapter, transactionScope: "database" });
  } catch {}

  try {
    const { createNodeSqliteAdapter } = await import("@/lib/db/adapters/nodeSqliteAdapter.js");
    adapterCases.push({ name: "node:sqlite", create: createNodeSqliteAdapter, transactionScope: "database" });
  } catch {}
} else {
  const { createBunSqliteAdapter } = await import("@/lib/db/adapters/bunSqliteAdapter.js");
  adapterCases.push({ name: "bun:sqlite", create: createBunSqliteAdapter, transactionScope: "database" });
}

const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
adapterCases.push({ name: "sql.js", create: createSqlJsAdapter, transactionScope: "process" });

function initializeSchema(adapter) {
  for (const [tableName, definition] of Object.entries(TABLES)) {
    adapter.exec(buildCreateTableSql(tableName, definition));
    for (const indexSql of definition.indexes || []) adapter.exec(indexSql);
  }
}

async function prepareForcedAdapter(adapterCase, tempDir) {
  const file = path.join(tempDir, "data.sqlite");
  const initial = await adapterCase.create(file);
  initializeSchema(initial);
  initial.close();

  const adapter = await adapterCase.create(file);
  vi.resetModules();
  delete global._dbAdapter;
  global._dbAdapter = { instance: adapter, initPromise: null, logged: true };
  const db = await import("@/lib/db/index.js");
  return { adapter, db, file };
}

afterEach(() => {
  delete global._dbAdapter;
});

describe.each(adapterCases)("forced $name reservation adapter", (adapterCase) => {
  it("keeps reservation admission and reconciliation parity", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `9router-${adapterCase.name.replace(/\W/g, "-")}-`));
    let adapter;
    try {
      ({ adapter } = await prepareForcedAdapter(adapterCase, tempDir));
      const db = await import("@/lib/db/index.js");
      expect(adapter.transactionScope).toBe(adapterCase.transactionScope);
      adapter.run(
        "INSERT INTO apiKeys(id, key, name, machineId, isActive, dailyLimitTokens, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?)",
        ["key-id", "sk-forced-adapter", "forced", "machine-test", 1, 1_000, "2026-07-19T12:00:00.000Z"],
      );
      const now = new Date("2026-07-19T12:00:00.000Z");
      const reservation = await db.reserveApiKeyUsage("sk-forced-adapter", 600, now);

      expect(reservation).toMatchObject({ accepted: true, reservedTokens: 600, remainingTokens: 400 });
      await db.saveRequestUsage({
        provider: "openai",
        model: "gpt-4o",
        apiKey: "sk-forced-adapter",
        usageReservationId: reservation.reservationId,
        timestamp: now.toISOString(),
        tokens: { prompt_tokens: 100, completion_tokens: 50, reasoning_tokens: 25 },
      });
      expect(await db.getApiKeyUsageLimitStatus("sk-forced-adapter", now)).toMatchObject({
        usedTokens: 175,
        reservedTokens: 0,
        remainingTokens: 825,
      });
    } finally {
      try { adapter?.close?.(); } catch {}
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

describe("sql.js reservation durability", () => {
  it("persists an accepted reservation before the transaction returns", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-sqljs-durable-"));
    let adapter;
    let observer;
    try {
      const prepared = await prepareForcedAdapter(
        { name: "sql.js", create: createSqlJsAdapter, transactionScope: "process" },
        tempDir,
      );
      ({ adapter } = prepared);
      adapter.run(
        "INSERT INTO apiKeys(id, key, name, machineId, isActive, dailyLimitTokens, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?)",
        ["key-id", "sk-sqljs-durable", "forced", "machine-test", 1, 1_000, "2026-07-19T12:00:00.000Z"],
      );
      const reservation = await prepared.db.reserveApiKeyUsage("sk-sqljs-durable", 600, new Date("2026-07-19T12:00:00.000Z"));

      observer = await createSqlJsAdapter(prepared.file);
      expect(observer.get("SELECT id FROM apiKeyUsageReservations WHERE id = ?", [reservation.reservationId])).toBeDefined();
    } finally {
      try { observer?.close?.(); } catch {}
      try { adapter?.close?.(); } catch {}
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});

const CHILD_SCRIPT = String.raw`
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const config = JSON.parse(process.argv[1]);
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
let adapter;
if (config.adapter === "better-sqlite3") {
  const { createBetterSqliteAdapter } = await import(pathToFileURL(config.betterAdapter).href);
  adapter = createBetterSqliteAdapter(config.dbFile);
} else {
  const { createNodeSqliteAdapter } = await import(pathToFileURL(config.nodeAdapter).href);
  adapter = await createNodeSqliteAdapter(config.dbFile);
}

const originalGet = adapter.get.bind(adapter);
adapter.get = (sql, params = []) => {
  const result = originalGet(sql, params);
  if (sql.includes("FROM apiKeyUsageReservations WHERE apiKeyId")) {
    fs.writeFileSync(config.reachedFile, "reached");
    while (!fs.existsSync(config.releaseFile)) sleep(2);
  }
  return result;
};
global._dbAdapter = { instance: adapter, initPromise: null, logged: true };
const { reserveApiKeyUsage } = await import(pathToFileURL(config.repoFile).href + "?worker=" + config.workerId);
fs.writeFileSync(config.readyFile, "ready");
while (!fs.existsSync(config.startFile)) sleep(2);

try {
  const result = await reserveApiKeyUsage("sk-native-contention", 60, new Date("2026-07-19T12:00:00.000Z"));
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  process.stdout.write(JSON.stringify({ error: error.message }));
} finally {
  adapter.close();
}
`;

async function seedNativeDatabase(file) {
  let raw;
  let run;
  try {
    const { default: Database } = await import("better-sqlite3");
    raw = new Database(file);
    run = (sql, params) => raw.prepare(sql).run(params);
  } catch {
    const { DatabaseSync } = await import("node:sqlite");
    raw = new DatabaseSync(file);
    run = (sql, params) => raw.prepare(sql).run(...params);
  }
  try {
    initializeSchema({ exec: (sql) => raw.exec(sql) });
    run(
      "INSERT INTO apiKeys(id, key, name, machineId, isActive, dailyLimitTokens, createdAt) VALUES(?, ?, ?, ?, ?, ?, ?)",
      ["key-id", "sk-native-contention", "native", "machine-test", 1, 100, "2026-07-19T12:00:00.000Z"],
    );
  } finally {
    raw.close();
  }
}

function spawnReservationWorker(config) {
  const child = spawn(process.execPath, ["--experimental-loader", aliasLoader, "--input-type=module", "--eval", CHILD_SCRIPT, JSON.stringify(config)], {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`reservation worker timed out: ${stderr}`));
    }, 20_000);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) reject(new Error(`reservation worker exited ${code}: ${stderr}`));
      else {
        try { resolve(JSON.parse(stdout)); }
        catch { reject(new Error(`invalid reservation worker output: ${stdout}\n${stderr}`)); }
      }
    });
  });
}

async function waitForAnyFile(files, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (files.some((file) => fs.existsSync(file))) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${files.join(", ")}`);
}

async function waitForAllFiles(files, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (files.every((file) => fs.existsSync(file))) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`timed out waiting for ${files.join(", ")}`);
}

const nativeAdapterNames = adapterCases
  .filter(({ transactionScope }) => transactionScope === "database" && !process.versions.bun)
  .map(({ name }) => name);

describe("native separate-connection reservation contention", () => {
  it.each(nativeAdapterNames)("serializes %s admission across 10 separate-process races", async (adapterName) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `9router-${adapterName.replace(/\W/g, "-")}-contention-`));
    try {
      for (let round = 0; round < 10; round += 1) {
        const roundDir = path.join(tempDir, String(round));
        fs.mkdirSync(roundDir);
        const dbFile = path.join(roundDir, "data.sqlite");
        await seedNativeDatabase(dbFile);
        const startFile = path.join(roundDir, "start");
        const releaseFile = path.join(roundDir, "release");
        const configs = [0, 1].map((worker) => ({
          adapter: adapterName,
          dbFile,
          startFile,
          releaseFile,
          readyFile: path.join(roundDir, `ready-${worker}`),
          reachedFile: path.join(roundDir, `reached-${worker}`),
          workerId: `${round}-${worker}`,
          repoFile: path.join(repoRoot, "src/lib/db/repos/apiKeysRepo.js"),
          betterAdapter: path.join(repoRoot, "src/lib/db/adapters/betterSqliteAdapter.js"),
          nodeAdapter: path.join(repoRoot, "src/lib/db/adapters/nodeSqliteAdapter.js"),
        }));
        const workers = [spawnReservationWorker(configs[0])];
        await waitForAllFiles([configs[0].readyFile]);
        workers.push(spawnReservationWorker(configs[1]));
        await waitForAllFiles([configs[1].readyFile]);
        fs.writeFileSync(startFile, "start");
        await waitForAnyFile(configs.map(({ reachedFile }) => reachedFile));
        await new Promise((resolve) => setTimeout(resolve, 100));
        fs.writeFileSync(releaseFile, "release");
        const results = await Promise.all(workers);

        expect(results.filter(({ accepted }) => accepted)).toHaveLength(1);
        expect(results.filter(({ accepted }) => accepted === false)).toHaveLength(1);
        expect(results.filter(({ error }) => error)).toEqual([]);
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }, 120_000);
});
