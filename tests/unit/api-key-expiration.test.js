import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
const originalDataDir = process.env.DATA_DIR;

function writeV2Db(dir) {
  fs.mkdirSync(path.join(dir, "db"), { recursive: true });
  const db = new DatabaseSync(path.join(dir, "db", "data.sqlite"));
  db.exec(`CREATE TABLE _meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  db.exec(`INSERT INTO _meta(key, value) VALUES ('schemaVersion', '2'), ('backupSchemaVersion', '2')`);
  db.exec(`CREATE TABLE apiKeys (
    id TEXT PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    name TEXT,
    machineId TEXT,
    isActive INTEGER DEFAULT 1,
    createdAt TEXT NOT NULL,
    accessRestricted INTEGER DEFAULT 0,
    accessAllow TEXT
  )`);
  const ins = db.prepare(`INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  ins.run("k1", "sk-existing-one", "Existing Key", "m", 1, "2026-09-01T00:00:00.000Z", 0, null);
  ins.run("k2", "sk-existing-paused", "Paused Key", "m", 0, "2026-09-02T00:00:00.000Z", 0, null);
  db.close();
}

async function boot() {
  delete global._dbAdapter;
  vi.resetModules();
  const db = await import("@/lib/db/index.js");
  const { getAdapter } = await import("@/lib/db/driver.js");
  return { db, adapter: await getAdapter() };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-key-expiry-"));
  process.env.DATA_DIR = tempDir;
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
  }
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("API key expiration: migration and repository behavior", () => {
  it("migrates existing keys without expiresAt to have expiresAt: null (never expired)", async () => {
    writeV2Db(tempDir);
    const { db, adapter } = await boot();

    const cols = adapter.all(`PRAGMA table_info(apiKeys)`).map((c) => c.name);
    expect(cols).toContain("expiresAt");

    const keys = await db.getApiKeys();
    expect(keys).toHaveLength(2);
    const k1 = keys.find((k) => k.id === "k1");
    expect(k1.expiresAt).toBeNull();
    expect(k1.isActive).toBe(true);

    expect(await db.validateApiKey("sk-existing-one")).toBe(true);
  });

  it("creates keys with custom expiration or null (never)", async () => {
    writeV2Db(tempDir);
    const { db } = await boot();

    const future = new Date(Date.now() + 86400000 * 7).toISOString();
    const createdWithExpiry = await db.createApiKey("Timed Key", "m", future);
    expect(createdWithExpiry.expiresAt).toBe(future);

    const createdNever = await db.createApiKey("Never Key", "m", null);
    expect(createdNever.expiresAt).toBeNull();

    const read = await db.getApiKeyById(createdWithExpiry.id);
    expect(read.expiresAt).toBe(future);
    expect(await db.validateApiKey(createdWithExpiry.key)).toBe(true);
  });

  it("updates key name and expiration date, including clearing to never", async () => {
    writeV2Db(tempDir);
    const { db } = await boot();

    const past = new Date(Date.now() - 3600000).toISOString();
    const updated = await db.updateApiKey("k1", { name: "Renamed Key", expiresAt: past });
    expect(updated.name).toBe("Renamed Key");
    expect(updated.expiresAt).toBe(past);

    expect(await db.validateApiKey("sk-existing-one")).toBe(false);

    // Clear back to never
    const cleared = await db.updateApiKey("k1", { expiresAt: null });
    expect(cleared.expiresAt).toBeNull();
    expect(await db.validateApiKey("sk-existing-one")).toBe(true);
  });

  it("validates API key status for various expiration states", async () => {
    writeV2Db(tempDir);
    const { db } = await boot();

    // Past expiration
    const past = new Date(Date.now() - 10000).toISOString();
    await db.createApiKey("Expired Key", "m", past);
    const all = await db.getApiKeys();
    const expKey = all.find((k) => k.name === "Expired Key");
    expect(await db.validateApiKey(expKey.key)).toBe(false);

    // Future expiration
    const future = new Date(Date.now() + 100000).toISOString();
    const futureKey = await db.createApiKey("Future Key", "m", future);
    expect(await db.validateApiKey(futureKey.key)).toBe(true);

    // Paused key
    expect(await db.validateApiKey("sk-existing-paused")).toBe(false);

    // Unknown key
    expect(await db.validateApiKey("sk-unknown")).toBe(false);

    // Missing key
    expect(await db.validateApiKey("")).toBe(false);
    expect(await db.validateApiKey(null)).toBe(false);
  });

  it("POST /api/keys accepts valid expiresAt and rejects invalid date", async () => {
    writeV2Db(tempDir);
    await boot();
    const { POST } = await import("@/app/api/keys/route.js");

    // Invalid date
    const badReq = new Request("http://localhost/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Bad Key", expiresAt: "invalid-date" }),
    });
    const badRes = await POST(badReq);
    expect(badRes.status).toBe(400);
    const badData = await badRes.json();
    expect(badData.error).toBe("Invalid expiration date");

    // Valid date
    const future = new Date(Date.now() + 86400000).toISOString();
    const goodReq = new Request("http://localhost/api/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Good Key", expiresAt: future }),
    });
    const goodRes = await POST(goodReq);
    expect(goodRes.status).toBe(201);
    const goodData = await goodRes.json();
    expect(goodData.expiresAt).toBe(future);
    expect(goodData.name).toBe("Good Key");
  });

  it("PUT /api/keys/[id] updates expiresAt and name, and can clear to never", async () => {
    writeV2Db(tempDir);
    await boot();
    const { PUT } = await import("@/app/api/keys/[id]/route.js");

    // Update with new name and future expiration
    const future = new Date(Date.now() + 86400000).toISOString();
    const req1 = new Request("http://localhost/api/keys/k1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed", expiresAt: future }),
    });
    const res1 = await PUT(req1, { params: Promise.resolve({ id: "k1" }) });
    expect(res1.status).toBe(200);
    const data1 = await res1.json();
    expect(data1.key.name).toBe("Renamed");
    expect(data1.key.expiresAt).toBe(future);

    // Clear expiration to null (never)
    const req2 = new Request("http://localhost/api/keys/k1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresAt: null }),
    });
    const res2 = await PUT(req2, { params: Promise.resolve({ id: "k1" }) });
    expect(res2.status).toBe(200);
    const data2 = await res2.json();
    expect(data2.key.expiresAt).toBeNull();

    // Reject invalid date
    const reqBad = new Request("http://localhost/api/keys/k1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresAt: "not-a-date" }),
    });
    const resBad = await PUT(reqBad, { params: Promise.resolve({ id: "k1" }) });
    expect(resBad.status).toBe(400);
  });
});
