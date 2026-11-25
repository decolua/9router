import { beforeEach, afterEach, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { format } from "node:util";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { reserveBudget, settleBudget, getBudgetBalance } from "../../src/lib/db/repos/budgetLedger.js";
import { meteredStream } from "../../src/sse/services/budgetResponse.js";

const budget = { provider: "openai-compatible-chat-fixture", model: "example", tokenLimit: 100, costLimitMicros: 200,
  inputRate: 1000000, outputRate: 2000000, inputTokenCeiling: 10, tariffDate: "2026-11-23" };
const policy = { budget, access: { restricted: true, allow: ["fixture/example", "Team"] },
  rpmLimit: 10, hourlyRequestLimit: 11, dailyRequestLimit: 12, monthlyRequestLimit: 13, expiresAt: "2099-01-01T00:00:00.000Z" };
let dir, db, repo, keys, item, rotate, guard, sign, token, logs;
const now = Date.now();
const ctx = id => ({ params: Promise.resolve({ id }) });
const request = (url, method, body, headers) => new NextRequest("http://localhost" + url, { method, headers,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const rotateRequest = (id, version, cookie = token) => rotate(request("/api/keys/" + id + "/rotate", "POST",
  { keyVersion: version }, cookie ? { cookie: "auth_token=" + cookie } : {}), ctx(id));
const admission = (key, method = "POST") => guard(request("/v1/chat/completions", method, undefined, { authorization: "Bearer " + key }));
const row = id => db.get("SELECT * FROM apiKeys WHERE id=?", [id]);
const use = key => repo.saveRequestUsage({ apiKey: key, provider: "openai-compatible-chat-fixture", model: "example", tokens: { prompt_tokens: 3, completion_tokens: 2 } });

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-rotation-"));
  vi.stubEnv("HOME", dir);
  vi.stubEnv("DATA_DIR", dir);
  vi.stubEnv("API_KEY_SECRET", ""); // exercise persisted pepper by default
  vi.resetModules();
  delete global._dbAdapter;
  logs = [];
  for (const method of ["log", "info", "warn", "error", "debug"]) {
    vi.spyOn(console, method).mockImplementation((...args) => logs.push(format(...args)));
  }
  repo = await import("@/lib/db/index.js");
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  expect(db.driver).not.toBe("sql.js");
  keys = await import("@/app/api/keys/route.js");
  item = await import("@/app/api/keys/[id]/route.js");
  ({ POST: rotate } = await import("@/app/api/keys/[id]/rotate/route.js"));
  ({ proxy: guard } = await import("@/dashboardGuard.js"));
  ({ createDashboardAuthToken: sign } = await import("@/lib/auth/dashboardSession.js"));
  token = await sign({ role: "admin" });
});
afterEach(() => {
  db?.close(); delete global._dbAdapter;
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

it("upgrades the previous DDL transactionally and computes the same keyed verifier on replay", async () => {
  vi.stubEnv("API_KEY_SECRET", "isolated-verifier-test-secret");
  const { createNodeSqliteAdapter } = await import("@/lib/db/adapters/nodeSqliteAdapter.js");
  const legacy = await createNodeSqliteAdapter(path.join(dir, "v4.sqlite"));
  const migration = (await import("@/lib/db/migrations/005-key-verifiers.js")).default;
  try {
    legacy.exec("CREATE TABLE apiKeys(id TEXT PRIMARY KEY, key TEXT NOT NULL UNIQUE)");
    legacy.run("INSERT INTO apiKeys VALUES('a','sk-synthetic-a'), ('b','sk-synthetic-b')");
    legacy.exec("CREATE TRIGGER abort_backfill BEFORE UPDATE ON apiKeys WHEN OLD.id='b' BEGIN SELECT RAISE(ABORT, 'fixture'); END");
    expect(() => migration.up(legacy)).toThrow("fixture");
    expect(legacy.all("PRAGMA table_info(apiKeys)").map(c => c.name)).toEqual(["id", "key"]);
    legacy.exec("DROP TRIGGER abort_backfill");
    migration.up(legacy);
    const snapshot = legacy.all("SELECT * FROM apiKeys ORDER BY id");
    for (const r of snapshot) {
      expect(r.key_version).toBe(1);
      expect(r.key_verifier).toBe(createHmac("sha256", process.env.API_KEY_SECRET)
        .update("9router:gateway-key:v1\0" + r.key).digest("hex"));
    }
    migration.up(legacy);
    expect(legacy.all("SELECT * FROM apiKeys ORDER BY id")).toEqual(snapshot);
  } finally { legacy.close(); }
});

async function restart() {
  db.close();
  delete global._dbAdapter;
  vi.resetModules();
  repo = await import("@/lib/db/index.js");
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  ({ proxy: guard } = await import("@/dashboardGuard.js"));
}

it("does not repair a NULL verifier on request and keeps the persisted pepper across restarts", async () => {
  const { id, key } = await repo.createApiKey("Fixture", "machine");
  const digest = row(id).key_verifier;
  db.run("UPDATE apiKeys SET key_verifier=NULL WHERE id=?", [id]);
  expect((await admission(key)).status).toBe(401);
  expect(row(id).key_verifier).toBeNull();
  expect(digest).toMatch(/^[a-f0-9]{64}$/);
  expect(fs.statSync(path.join(dir, "key-verifier-pepper")).mode & 0o777).toBe(0o600);
  expect(await repo.validateApiKey(digest)).toBe(false);
  vi.resetModules();
  const { keyVerifier } = await import("@/lib/db/helpers/keyVerifier.js");
  expect(keyVerifier(key)).toBe(digest);
});

it.each(["configured secret", "pepper"])("repairs the verifier once after replacement of the %s", async (source) => {
  const configured = source === "configured secret";
  if (configured) vi.stubEnv("API_KEY_SECRET", "original-fixture-secret");
  const { id, key } = await repo.createApiKey("Recovery", "machine");
  const previous = row(id).key_verifier;
  const pepperFile = path.join(dir, "key-verifier-pepper");
  if (configured) {
    vi.stubEnv("API_KEY_SECRET", "replacement-fixture-secret");
  } else {
    fs.unlinkSync(pepperFile);

  }
  await restart();
  const warn = vi.mocked(console.warn);
  warn.mockClear();
  const secret = configured ? process.env.API_KEY_SECRET : fs.readFileSync(pepperFile);
  const expected = createHmac("sha256", secret).update("9router:gateway-key:v1\0" + key).digest("hex");
  expect(expected).not.toBe(previous);
  expect(row(id).key_verifier).toBe(expected);
  expect((await admission(key)).status).toBe(200);
  expect(warn.mock.calls).toEqual([]);
});

it("denies a required key rotated between admission and policy lookup even after a verifier secret change", async () => {
  await repo.updateSettings({ requireApiKey: true });
  const { getKeyAccessContext, enforceKeyAccess } = await import("@/sse/services/keyAccess.js");
  const { id, key } = await repo.createApiKey("Race", "machine");
  const pending = request("/v1/chat/completions", "POST", undefined, { authorization: "Bearer " + key });
  expect((await guard(pending)).status).toBe(200);
  const rotated = await rotateRequest(id, 1);
  expect(rotated.status).toBe(200);
  const current = await rotated.json();
  vi.stubEnv("API_KEY_SECRET", "new-fixture-secret");
  const digest = row(id).key_verifier;
  expect((await enforceKeyAccess(await getKeyAccessContext(pending), "openai/model-a")).status).toBe(403);
  expect((await admission(key)).status).toBe(401);
  expect(row(id).key_verifier).toBe(digest);
  await restart();
  expect((await admission(current.key)).status).toBe(200);
  expect((await admission(key)).status).toBe(401);
});

it("keeps all counters and holds; a stream opened before rotation settles exactly once afterwards", async () => {
  const { id, key } = await repo.createApiKey("Team", "machine", policy);
  expect((await admission(key)).status).toBe(200);
  await use(key);
  for (const req of ["finished", "stream"]) expect(reserveBudget(db, req, id, budget, 5, now).status).toBe(200);
  expect(settleBudget(db, "finished", { prompt_tokens: 3, completion_tokens: 2 })).toBe(true);
  let controller;
  const stream = new ReadableStream({ start(c) { controller = c; } });
  const reader = meteredStream(stream, usage => settleBudget(db, "stream", usage)).getReader();
  const enc = new TextEncoder();
  controller.enqueue(enc.encode('data: {"choices":[{}]}\n\n'));
  await reader.read();
  const previous = row(id);
  const balance = getBudgetBalance(db, id, now);
  expect(balance).toMatchObject({ requests: 2, usedMicros: 7, holds: 1, heldMicros: 20 });
  const response = await rotateRequest(id, previous.key_version);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const result = await response.json();
  expect(result).toEqual({ id, key: expect.any(String), keyVersion: 2 });
  expect(row(id)).toEqual({ ...previous, key_ciphertext: expect.not.stringContaining(previous.key_ciphertext), key_version: 2, key_verifier: expect.not.stringContaining(previous.key_verifier) });
  expect(getBudgetBalance(db, id, now)).toEqual(balance);
  for (const method of ["GET", "POST"]) expect((await admission(key, method)).status).toBe(401);
  expect((await admission(result.key)).status).toBe(200);
  expect(await repo.getApiKeyByKey(result.key)).toMatchObject({ id, ...policy });
  await use(result.key);
  controller.enqueue(enc.encode('data: {"choices":[],"usage":{"prompt_tokens":2,"completion_tokens":1}}\n\ndata: [DONE]\n\n'));
  controller.close(); await reader.read(); expect((await reader.read()).done).toBe(true);
  expect(settleBudget(db, "stream", { prompt_tokens: 10, completion_tokens: 5 })).toBe(false);
  expect(getBudgetBalance(db, id, now)).toMatchObject({ requests: 2, holds: 0, usedMicros: 11 });
  for (const period of ["24h", "all"]) {
    const stats = await repo.getUsageStats(period);
    expect(Object.values(stats.byApiKey)).toEqual([expect.objectContaining({ keyId: id, requests: 2, promptTokens: 6 })]);
  }
  expect((await repo.getUsageHistory()).map(r => r.keyId)).toEqual([id, id]);
  const fp = db.get("SELECT fingerprint FROM retiredKeyFingerprints").fingerprint;
  expect((await admission(fp)).status).toBe(401);
});

it("serializes rotations from independent WAL connections and rejects replay at the HTTP handler", async () => {
  const { id, key } = await repo.createApiKey("Race", "machine");
  const barrier = new SharedArrayBuffer(4);
  const workers = Array.from({ length: 2 }, () => new Worker(new URL("../fixtures/key-rotation-worker.mjs", import.meta.url),
    { workerData: { file: path.join(dir, "db/data.sqlite"), id, version: 1, barrier } }));
  try {
    await Promise.all(workers.map(w => once(w, "message")));
    const both = Promise.all(workers.map(w => once(w, "message")));
    workers.forEach(w => w.postMessage("start"));
    const outcomes = (await both).map(([r]) => r).sort((a, b) => a.result.status - b.result.status);
    const [winner, loser] = outcomes.map(r => r.result);
    expect(loser).toEqual({ status: 409 });
    expect(outcomes[1].candidate).toEqual(expect.any(String));
    expect(await repo.validateApiKey(outcomes[1].candidate)).toBe(false);
    expect(winner).toMatchObject({ status: 200, id, keyVersion: 2 });
    expect(await repo.validateApiKey(winner.key)).toBe(true);
    expect(await repo.validateApiKey(key)).toBe(false);
    const replies = await Promise.all([rotateRequest(id, 2), rotateRequest(id, 2)]);
    expect(replies.map(r => r.status).sort()).toEqual([200, 409]);
    expect(await replies.find(r => r.status === 409).json()).toEqual({ error: "Key version changed" });
    expect(await repo.validateApiKey(winner.key)).toBe(false);
    expect(await repo.validateApiKey((await replies.find(r => r.status === 200).json()).key)).toBe(true);
    expect(db.all("SELECT id FROM apiKeys WHERE key_verifier IS NOT NULL")).toHaveLength(1);
  } finally { await Promise.all(workers.map(w => w.terminate())); }
});

it("rolls back a failure after credential replacement without leaking exception details", async () => {
  const { id, key } = await repo.createApiKey("Rollback", "machine", policy);
  expect((await admission(key)).status).toBe(200);
  const previous = row(id);
  const injected = "sk-synthetic-error-secret";
  db.exec("CREATE TRIGGER abort_rotation BEFORE INSERT ON retiredKeyFingerprints BEGIN SELECT RAISE(ABORT, 'sk-synthetic-error-secret'); END");
  const response = await rotateRequest(id, 1);
  expect(response.status).toBe(500);
  const output = (await response.text()) + logs.join("\n");
  for (const secret of [key, previous.key_verifier, injected]) expect(output).not.toContain(secret);
  expect(row(id)).toEqual(previous);
  expect(await repo.validateApiKey(key)).toBe(true);
  expect(db.all("SELECT * FROM retiredKeyFingerprints")).toHaveLength(0);
});

it("returns the current full key record to legacy clients before and after rotation", async () => {
  const created = await repo.createApiKey("Legacy client", "machine", policy);
  const read = async response => {
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(body).not.toContain("key_verifier");
    expect(body).not.toContain(row(created.id).key_verifier);
    return JSON.parse(body);
  };
  const list = async () => read(await keys.GET(request("/api/keys", "GET")));
  const before = await list();
  expect(before).toEqual({ keys: [{ ...created, keyVersion: 1 }] });
  const response = await rotateRequest(created.id, before.keys[0].keyVersion);
  expect(response.status).toBe(200);
  const rotated = await response.json();
  expect(rotated.key).not.toBe(created.key);
  const current = { ...created, key: rotated.key, keyVersion: before.keys[0].keyVersion + 1 };
  expect(await list()).toEqual({ keys: [current] });
  expect(await read(await item.GET(null, ctx(created.id)))).toEqual({ key: current });
  const edited = await item.PUT(request("/api/keys/" + created.id, "PUT", { isActive: false }), ctx(created.id));
  expect(await read(edited)).toEqual({ key: { ...current, isActive: false } });
  expect(await repo.validateApiKey(rotated.key)).toBe(false);
});

it("denies anonymous and Viewer rotations even with login disabled; omits credentials from summaries, errors and logs", async () => {
  await repo.updateSettings({ requireLogin: false });
  const { key, id } = await repo.createApiKey("Private", "machine");
  const original = row(id);
  const replies = [];
  for (const [auth, code] of [["", 401], [await sign({ role: "viewer" }), 403], ["bad-token", 401]]) {
    const r = await rotateRequest(id, 1, auth);
    expect(r.status).toBe(code); replies.push(await r.text());
  }
  expect(row(id)).toEqual(original);
  const rotated = await (await rotateRequest(id, 1, await sign({ role: "admin" }))).json();
  const database = await import("@/app/api/settings/database/route.js");
  vi.stubEnv("INITIAL_PASSWORD", "fixture-admin-password");
  const backup = await database.GET(request("/api/settings/database", "GET", undefined, { "x-9r-password": "fixture-admin-password" }));
  expect(backup.status).toBe(200);
  expect(backup.headers.get("cache-control")).toBe("no-store");
  const exported = await backup.text();
  expect(JSON.parse(exported).apiKeys).toMatchObject([{ id, key: rotated.key }]);
  for (const excluded of [key, "key_verifier", original.key_verifier, row(id).key_verifier]) expect(exported).not.toContain(excluded);
  await expect(repo.importDb({ apiKeys: [] })).rejects.toThrow("Rotated keys require a full SQLite backup");
  const invalid = await item.PUT(request("/api/keys/" + id, "PUT", { access: { [rotated.key]: true } }), ctx(id));
  expect(invalid.status).toBe(400); replies.push(await invalid.text());
  const summary = await keys.GET(request("/api/keys?view=summary", "GET"));
  expect(summary.status).toBe(200);
  expect(summary.headers.get("cache-control")).toBe("no-store");
  const summaryBody = await summary.text();
  expect(JSON.parse(summaryBody)).toEqual({ keys: [{ id, name: "Private", owner: null, project: null, isActive: true, createdAt: original.createdAt, expiresAt: null }] });
  replies.push(summaryBody);
  await repo.updateApiKey(id, { isActive: true, expiresAt: "2001-01-01T00:00:00Z" });
  expect((await admission(rotated.key)).status).toBe(401);
  for (const [version, code] of [[1, 409], [null, 400], [key, 400]]) {
    const r = await rotateRequest(id, version); expect(r.status).toBe(code); replies.push(await r.text());
  }
  const output = [...replies, ...logs].join("\n");
  for (const secret of [key, rotated.key, original.key_verifier, row(id).key_verifier]) expect(output).not.toContain(secret);
});
