// Task 15 end-to-end proof: durable webhook delivery across process crashes.
//
// This file deliberately uses real child processes, real SQLite files and a
// loopback HTTP receiver. It never imports a provider and never reaches the
// public network. Parent runs it inside the approved isolated sandbox.
//
// Native backends are the only ones used across process boundaries. sql.js is
// covered separately because its database is an in-memory snapshot: sharing one
// file between live writers is unsafe, so the mandatory sql.js assertions are
// explicit-flush plus single-owner snapshot behavior, not a fake crash test.
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import initSqlJs from "sql.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const PRODUCER = path.join(HERE, "..", "fixtures", "webhooks", "producer.mjs");
const ALIAS_REGISTER = path.join(HERE, "..", "fixtures", "webhooks", "register-aliases.mjs");
const DUMMY_SECRET = "fixture-signing-secret-not-for-production";
const NOW = Date.parse("2026-10-23T10:00:00.000Z");

const NODE_BIN = process.env.WEBHOOK_E2E_NODE || (process.versions.bun ? "node" : process.execPath);
const versionProbe = spawnSync(NODE_BIN, ["--version"], { encoding: "utf8", timeout: 5000 });
const NODE_VERSION = (versionProbe.stdout || "").trim();
function nativeSupported(version) {
  const match = /^v(\d+)\.(\d+)\./.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 22 || (major === 22 && minor >= 5);
}
// node:sqlite is flag-gated on part of Node 22, so version parsing alone is
// not proof that the native adapter can load. Bun's bun:sqlite is native too,
// but this file always spawns a Node executable so runner and fixture agree.
const sqliteProbe = versionProbe.status === 0 && nativeSupported(NODE_VERSION)
  ? spawnSync(NODE_BIN, ["--input-type=module", "-e", "import('node:sqlite').then(() => {}, () => process.exit(2))"], { timeout: 5000 })
  : null;
const NATIVE_READY = Boolean(sqliteProbe && sqliteProbe.status === 0);

const BASE_LISTENERS = Object.fromEntries(
  ["beforeExit", "SIGINT", "SIGTERM"].map((name) => [name, process.listeners(name)]),
);
const ORIGINAL_GLOBAL_DB = globalThis._dbAdapter;
const ORIGINAL_DATA_DIR = process.env.DATA_DIR;

const tempDirs = [];
const servers = [];
const children = new Set();
const sqlAdapters = [];

function makeTempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-webhook-e2e-"));
  tempDirs.push(dir);
  return dir;
}

function fixtureEnvelope(eventId, now = NOW) {
  return {
    id: eventId,
    type: "request.failed",
    schema_version: 1,
    occurred_at: new Date(now).toISOString(),
    severity: "error",
    data: {
      requestId: `fixture-request-${eventId}`,
      modality: "chat",
      provider: "cx",
      model: "fixture-model",
      errorClass: "upstream_http",
      statusCode: 503,
      partialResponse: false,
    },
  };
}

async function withTimeout(promise, ms, label, handle) {
  let timer = null;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const stderr = handle?.stderr?.() ?? "";
      reject(new Error(`${label} timed out after ${ms}ms${stderr ? `: ${stderr}` : ""}`));
    }, ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

function startFixture(mode, config, dataDir) {
  const child = spawn(NODE_BIN, ["--import", ALIAS_REGISTER, PRODUCER], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      WEBHOOK_FIXTURE: JSON.stringify({ mode, ...config }),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  const lines = [];
  const waiters = new Set();
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const reader = readline.createInterface({ input: child.stdout });
  reader.on("line", (line) => {
    if (!line.startsWith("FIXTURE:")) return;
    try { lines.push(JSON.parse(line.slice("FIXTURE:".length))); } catch { return; }
    for (const waiter of [...waiters]) waiter();
  });
  const exit = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const waitFor = (count) => (lines.length >= count ? Promise.resolve() : new Promise((resolve) => {
    const waiter = () => {
      if (lines.length < count) return;
      waiters.delete(waiter);
      resolve();
    };
    waiters.add(waiter);
  }));
  return {
    child,
    lines,
    stderr: () => stderr,
    waitFor,
    async waitFirst() {
      await waitFor(1);
      return lines[0];
    },
    waitExit: () => exit,
    async kill() {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      return exit;
    },
  };
}

async function runFixture(mode, config, dataDir, timeoutMs = 25_000) {
  const handle = startFixture(mode, config, dataDir);
  const exited = await withTimeout(handle.waitExit(), timeoutMs, `fixture ${mode}`, handle);
  if (exited.code !== 0) {
    throw new Error(`fixture ${mode} exited ${exited.code}/${exited.signal}: ${handle.stderr()}`);
  }
  await withTimeout(handle.waitFirst(), 5000, `fixture ${mode} output`, handle);
  return handle;
}

async function prepareDestination(receiver, dataDir, overrides = {}) {
  const handle = await runFixture("prepare", {
    url: receiver.url,
    signingSecret: DUMMY_SECRET,
    ...overrides,
  }, dataDir);
  const prepared = handle.lines[0];
  expect(prepared).toMatchObject({
    mode: "prepare",
    destinationId: expect.any(String),
    revision: 1,
  });
  expect(["node:sqlite", "bun:sqlite", "better-sqlite3"]).toContain(prepared.driver);
  return prepared;
}

async function startReceiver() {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ method: request.method, url: request.url, headers: request.headers, body });
      const parsed = body ? JSON.parse(body) : null;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: parsed?.id || "fixture-ack" }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const entry = {
    url: `http://127.0.0.1:${address.port}/hook`,
    requests,
    closed: false,
    async close() {
      if (entry.closed) return;
      entry.closed = true;
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
  servers.push(entry);
  return entry;
}

async function snapshotRows(file, sql) {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(file));
  try {
    const result = db.exec(sql)[0];
    if (!result) return [];
    return result.values.map((values) => Object.fromEntries(result.columns.map((column, index) => [column, values[index]])));
  } finally {
    db.close();
  }
}

async function createSqlJsHarness(dir) {
  const dbDir = path.join(dir, "db");
  fs.mkdirSync(dbDir, { recursive: true });
  const file = path.join(dbDir, "data.sqlite");
  process.env.DATA_DIR = dir;
  vi.resetModules();
  delete globalThis._dbAdapter;
  const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
  const adapter = await createSqlJsAdapter(file);
  sqlAdapters.push(adapter);
  globalThis._dbAdapter = { instance: adapter, initPromise: null, logged: true };
  const { runMigrationOnce } = await import("@/lib/db/migrate.js");
  await runMigrationOnce(adapter);
  const destinations = await import("@/lib/db/repos/webhooksRepo.js");
  const outbox = await import("@/lib/db/repos/webhookDeliveriesRepo.js");
  return { adapter, file, destinations, outbox };
}

async function sqlJsDestination(destinations) {
  const created = await destinations.createWebhookDestination({
    name: "sql.js fixture destination",
    kind: "generic",
    url: "http://127.0.0.1:9/not-sent",
    enabled: true,
    events: ["request.failed"],
    allowPrivateNetwork: true,
    cooldownSeconds: 0,
    signingSecret: DUMMY_SECRET,
  });
  expect(created.ok).toBe(true);
  return created.destination;
}

afterEach(async () => {
  await Promise.all([...children].map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGKILL");
    await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))]);
  }));
  children.clear();
  for (const server of servers.splice(0).reverse()) await server.close();
  for (const adapter of sqlAdapters.splice(0).reverse()) {
    try { adapter.close(); } catch { /* teardown only */ }
  }
  for (const [name, previous] of Object.entries(BASE_LISTENERS)) {
    for (const listener of process.listeners(name)) {
      if (!previous.includes(listener)) process.removeListener(name, listener);
    }
  }
  for (const dir of tempDirs.splice(0).reverse()) fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.resetModules();
  globalThis._dbAdapter = ORIGINAL_GLOBAL_DB;
  if (ORIGINAL_DATA_DIR === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = ORIGINAL_DATA_DIR;
});

describe("webhook integration: native runtime capability", () => {
  it("has a Node >= 22.5 executable for cross-process crash coverage", () => {
    expect(
      NATIVE_READY,
      `set WEBHOOK_E2E_NODE to a Node with a loadable node:sqlite; got ${NODE_BIN} ${NODE_VERSION || "(no version)"}`,
    ).toBe(true);
  });
});

describe.skipIf(!NATIVE_READY)("webhook integration: crash recovery on a native backend", () => {
  it("delivers the same eventId after enqueue+flush is SIGKILLed before the restart", async () => {
    const receiver = await startReceiver();
    const dir = makeTempDir();
    const prepared = await prepareDestination(receiver, dir, { enabled: true });

    const eventId = crypto.randomUUID();
    const producer = startFixture("enqueue", { eventId, now: NOW, hang: true }, dir);
    const queued = await withTimeout(producer.waitFirst(), 20_000, "enqueue", producer);
    expect(queued.result).toMatchObject({ ok: true, deliveryIds: [expect.any(String)] });
    await withTimeout(producer.waitFor(2), 5000, "enqueue ready", producer);
    const killed = await producer.kill();
    expect(killed).toMatchObject({ code: null, signal: "SIGKILL" });
    expect(receiver.requests).toHaveLength(0);

    const delivered = await runFixture("deliver", { now: NOW + 5000 }, dir);
    expect(delivered.lines[0].outcomes).toEqual([
      expect.objectContaining({ eventId, outcome: "delivered", applied: true }),
    ]);
    expect(receiver.requests).toHaveLength(1);
    expect(receiver.requests[0].headers["webhook-id"]).toBe(eventId);
    expect(JSON.parse(receiver.requests[0].body).id).toBe(eventId);

    const inspected = await runFixture("inspect", {}, dir);
    expect(inspected.lines[0].driver).toBe(prepared.driver);
    expect(inspected.lines[0].rows).toMatchObject([
      { eventId, status: "delivered", attempts: 1 },
    ]);
  }, 30_000);

  it("re-sends the same eventId after ack is delivered but the producer dies before completion", async () => {
    const receiver = await startReceiver();
    const dir = makeTempDir();
    await prepareDestination(receiver, dir, { enabled: true });

    const eventId = crypto.randomUUID();
    const producer = startFixture("enqueue", { eventId, now: NOW, hang: true }, dir);
    await withTimeout(producer.waitFirst(), 20_000, "enqueue", producer);
    await withTimeout(producer.waitFor(2), 5000, "enqueue ready", producer);
    expect(await producer.kill()).toMatchObject({ code: null, signal: "SIGKILL" });

    const partial = startFixture("deliver-partial", { now: NOW + 5000 }, dir);
    const sent = await withTimeout(partial.waitFirst(), 20_000, "partial delivery", partial);
    expect(sent).toMatchObject({ eventId, status: 200 });
    await withTimeout(partial.waitFor(2), 5000, "partial ready", partial);
    expect(await partial.kill()).toMatchObject({ code: null, signal: "SIGKILL" });
    expect(receiver.requests).toHaveLength(1);

    const before = await runFixture("inspect", {}, dir);
    expect(before.lines[0].rows).toMatchObject([
      { eventId, status: "inflight", attempts: 1 },
    ]);

    // The lease was 30s from NOW+5000. Skip the wait with the injectable clock.
    const recovered = await runFixture("deliver", { now: NOW + 5000 + 31_000 }, dir);
    expect(recovered.lines[0].outcomes).toEqual([
      expect.objectContaining({ eventId, outcome: "delivered", applied: true }),
    ]);
    expect(receiver.requests).toHaveLength(2);
    expect(receiver.requests.map((request) => request.headers["webhook-id"])).toEqual([eventId, eventId]);
    expect(receiver.requests.map((request) => JSON.parse(request.body).id)).toEqual([eventId, eventId]);

    const after = await runFixture("inspect", {}, dir);
    expect(after.lines[0].rows).toMatchObject([
      { eventId, status: "delivered", attempts: 2 },
    ]);
  }, 40_000);

  it("blocks operational sends while disabled but delivers a new explicit test after restart", async () => {
    const receiver = await startReceiver();
    const dir = makeTempDir();
    const prepared = await prepareDestination(receiver, dir, {
      enabled: false,
      events: ["request.failed"],
    });

    const blocked = await runFixture("enqueue", {
      eventId: crypto.randomUUID(),
      now: NOW,
    }, dir);
    expect(blocked.lines[0].result).toMatchObject({ ok: true, deliveryIds: [] });
    const noSend = await runFixture("deliver", { now: NOW + 5000 }, dir);
    expect(noSend.lines[0].outcomes).toEqual([]);
    expect(receiver.requests).toHaveLength(0);

    const queued = await runFixture("enqueue-test", {
      destinationId: prepared.destinationId,
      now: NOW + 6000,
    }, dir);
    const deliveryId = queued.lines[0].result.deliveryIds[0];
    expect(deliveryId).toEqual(expect.any(String));
    const pending = await runFixture("inspect", {}, dir);
    expect(pending.lines[0].rows).toMatchObject([
      { id: deliveryId, deliveryKind: "test", status: "pending" },
    ]);

    // A separate process proves the test row survives the producer restart.
    const delivered = await runFixture("deliver", { now: NOW + 12_000 }, dir);
    expect(delivered.lines[0].outcomes).toEqual([
      expect.objectContaining({ deliveryId, deliveryKind: "test", outcome: "delivered", applied: true }),
    ]);
    expect(receiver.requests).toHaveLength(1);
    expect(receiver.requests[0].headers["webhook-id"]).toBe(pending.lines[0].rows[0].eventId);

    const finalState = await runFixture("inspect", {}, dir);
    expect(finalState.lines[0].rows).toMatchObject([
      { id: deliveryId, deliveryKind: "test", status: "delivered" },
    ]);
  }, 40_000);

  it("never sends stale revision/generation work and cancels a queued test on disable", async () => {
    const receiver = await startReceiver();
    const dir = makeTempDir();
    const prepared = await prepareDestination(receiver, dir, { enabled: true });

    const oldTest = await runFixture("enqueue-test", {
      destinationId: prepared.destinationId,
      now: NOW,
    }, dir);
    const oldId = oldTest.lines[0].result.deliveryIds[0];
    await runFixture("disable", { destinationId: prepared.destinationId }, dir);
    const cancelled = await runFixture("inspect", {}, dir);
    expect(cancelled.lines[0].rows).toMatchObject([{ id: oldId, status: "cancelled" }]);

    const staleTest = await runFixture("enqueue-test", {
      destinationId: prepared.destinationId,
      now: NOW + 1000,
    }, dir);
    expect(staleTest.lines[0].result.deliveryIds).toHaveLength(1);
    const claimed = await runFixture("claim", { now: NOW + 2000 }, dir);
    const lease = claimed.lines[0].lease;
    expect(lease).toMatchObject({ deliveryKind: "test", destinationRevision: 2, attempts: 1 });

    await runFixture("rename", { destinationId: prepared.destinationId, value: "Revision two" }, dir);
    const stale = await runFixture("deliver-lease", { lease, now: NOW + 3000 }, dir);
    expect(stale.lines[0].result).toMatchObject({ sent: false, applied: false, outcome: "skipped", reason: "stale" });
    expect(receiver.requests).toHaveLength(0);

    const generationTest = await runFixture("enqueue-test", {
      destinationId: prepared.destinationId,
      now: NOW + 3000,
    }, dir);
    expect(generationTest.lines[0].result.deliveryIds).toHaveLength(1);
    const reset = await runFixture("reset", { now: NOW + 4000 }, dir);
    expect(reset.lines[0].result).toMatchObject({ ok: true, generation: 2 });

    const afterReset = await runFixture("deliver", { now: NOW + 9000 }, dir);
    expect(afterReset.lines[0].outcomes).toEqual([]);
    const empty = await runFixture("inspect", {}, dir);
    expect(empty.lines[0].rows).toEqual([]);
    expect(receiver.requests).toHaveLength(0);
  }, 40_000);

  it("persists a routed request.failed through the real events sink and delivers it after restart", async () => {
    const receiver = await startReceiver();
    const dir = makeTempDir();
    await prepareDestination(receiver, dir, { enabled: true });

    const emitted = await runFixture("emit-failure", {
      requestId: "fixture-routing-request",
      now: NOW,
    }, dir);
    expect(emitted.lines[0].finalized).toMatchObject({ emitted: true, reason: "emitted" });
    expect(emitted.lines[0].row).toMatchObject({
      type: "request.failed",
      deliveryKind: "operational",
      status: "pending",
    });
    const eventId = emitted.lines[0].row.eventId;
    const dueAt = Date.parse(emitted.lines[0].row.nextAttemptAt);
    expect(Number.isFinite(dueAt)).toBe(true);

    const delivered = await runFixture("deliver", { now: dueAt }, dir);
    expect(delivered.lines[0].outcomes).toEqual([
      expect.objectContaining({ eventId, outcome: "delivered", applied: true }),
    ]);
    expect(receiver.requests).toHaveLength(1);
    const body = JSON.parse(receiver.requests[0].body);
    expect(body).toMatchObject({
      id: eventId,
      type: "request.failed",
      data: { requestId: "fixture-routing-request", modality: "chat" },
    });
    expect(receiver.requests[0].headers["webhook-id"]).toBe(eventId);
  }, 30_000);
});

describe("webhook integration: sql.js single-owner persistence boundary", () => {
  it("makes an enqueued event durable only after explicit flush, readable by a reopened snapshot", async () => {
    const dir = makeTempDir();
    const harness = await createSqlJsHarness(dir);
    expect(harness.adapter.driver).toBe("sql.js");
    await sqlJsDestination(harness.destinations);

    const eventId = crypto.randomUUID();
    const queued = await harness.outbox.enqueueWebhookEvent(fixtureEnvelope(eventId), { now: NOW });
    expect(queued).toMatchObject({ ok: true, deliveryIds: [expect.any(String)] });
    harness.adapter.flush();

    const rows = await snapshotRows(
      harness.file,
      "SELECT eventId, deliveryKind, status FROM webhookDeliveries ORDER BY createdAt, id",
    );
    expect(rows).toEqual([{ eventId, deliveryKind: "operational", status: "pending" }]);
  }, 20_000);

  it("proves the single-owner snapshot: an already-open second owner cannot observe later writes", async () => {
    const dir = makeTempDir();
    const harness = await createSqlJsHarness(dir);
    await sqlJsDestination(harness.destinations);
    harness.adapter.flush();

    const { createSqlJsAdapter } = await import("@/lib/db/adapters/sqljsAdapter.js");
    const observer = await createSqlJsAdapter(harness.file);
    sqlAdapters.push(observer);
    const count = () => Number(observer.get("SELECT COUNT(*) AS c FROM webhookDeliveries").c);

    expect(count()).toBe(0);
    const queued = await harness.outbox.enqueueWebhookEvent(fixtureEnvelope(crypto.randomUUID()), { now: NOW + 1000 });
    expect(queued.ok).toBe(true);
    // The repository performs its own explicit flush, but an already-open
    // sql.js owner is a snapshot and cannot observe live writes.
    expect(count()).toBe(0);

    harness.adapter.flush();
    expect(count()).toBe(0);

    const reopened = await createSqlJsAdapter(harness.file);
    sqlAdapters.push(reopened);
    expect(Number(reopened.get("SELECT COUNT(*) AS c FROM webhookDeliveries").c)).toBe(1);
  }, 20_000);
});
