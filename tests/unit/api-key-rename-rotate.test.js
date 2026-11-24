// API key rename + rotate: PUT /api/keys/[id] accepts a validated `name`,
// POST /api/keys/[id]/rotate swaps the secret while keeping id/name/access/isActive,
// and the repo-level rotate upgrades legacy sk-{random8} keys to the machine format.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const MACHINE = "0123456789abcdef";

vi.mock("@/shared/utils/machineId", () => ({
  getConsistentMachineId: async () => MACHINE,
}));

let tempDir;
const originalDataDir = process.env.DATA_DIR;

async function boot() {
  delete global._dbAdapter;
  vi.resetModules();
  const db = await import("@/lib/db/index.js");
  const keysRoute = await import("../../src/app/api/keys/route.js");
  const keyRoute = await import("../../src/app/api/keys/[id]/route.js");
  const rotateRoute = await import("../../src/app/api/keys/[id]/rotate/route.js");
  return { db, keysRoute, keyRoute, rotateRoute };
}

const json = (method, body) => new Request("http://localhost/api/keys", {
  method,
  headers: { "Content-Type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const params = (id) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-key-rotate-"));
  process.env.DATA_DIR = tempDir;
});

afterEach(() => {
  try { global._dbAdapter?.instance?.close?.(); } catch {}
  delete global._dbAdapter;
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
});

describe("validateKeyName", () => {
  it("trims, rejects empty / non-string / too long", async () => {
    const { validateKeyName, KEY_NAME_MAX_LENGTH } = await import("@/shared/utils/keyName.js");
    expect(validateKeyName("  Prod  ")).toEqual({ ok: true, value: "Prod" });
    expect(validateKeyName("").ok).toBe(false);
    expect(validateKeyName("   ").ok).toBe(false);
    expect(validateKeyName(undefined).ok).toBe(false);
    expect(validateKeyName(42).ok).toBe(false);
    expect(validateKeyName("x".repeat(KEY_NAME_MAX_LENGTH)).ok).toBe(true);
    expect(validateKeyName("x".repeat(KEY_NAME_MAX_LENGTH + 1)).ok).toBe(false);
  });
});

describe("PUT /api/keys/[id] name", () => {
  it("renames and keeps key/access/isActive", async () => {
    const { db, keyRoute } = await boot();
    const created = await db.createApiKey("Old", MACHINE);
    await db.updateApiKey(created.id, { isActive: false, access: { restricted: true, allow: ["Main"] } });

    const res = await keyRoute.PUT(json("PUT", { name: "  New name " }), params(created.id));
    expect(res.status).toBe(200);
    const { key } = await res.json();
    expect(key.name).toBe("New name");
    expect(key.key).toBe(created.key);
    expect(key.isActive).toBe(false);
    expect(key.access).toEqual({ restricted: true, allow: ["Main"] });

    const stored = await db.getApiKeyById(created.id);
    expect(stored.name).toBe("New name");
  });

  it("400s on an empty name and leaves the key untouched", async () => {
    const { db, keyRoute } = await boot();
    const created = await db.createApiKey("Keep", MACHINE);
    const res = await keyRoute.PUT(json("PUT", { name: "   " }), params(created.id));
    expect(res.status).toBe(400);
    expect((await db.getApiKeyById(created.id)).name).toBe("Keep");
  });

  it("ignores name when not provided (isActive-only update still works)", async () => {
    const { db, keyRoute } = await boot();
    const created = await db.createApiKey("Keep", MACHINE);
    const res = await keyRoute.PUT(json("PUT", { isActive: false }), params(created.id));
    expect(res.status).toBe(200);
    const stored = await db.getApiKeyById(created.id);
    expect(stored.name).toBe("Keep");
    expect(stored.isActive).toBe(false);
  });
});

describe("POST /api/keys (name validation shared)", () => {
  it("trims the name and rejects whitespace-only", async () => {
    const { keysRoute } = await boot();
    const ok = await keysRoute.POST(json("POST", { name: "  Prod " }));
    expect(ok.status).toBe(201);
    expect((await ok.json()).name).toBe("Prod");
    const bad = await keysRoute.POST(json("POST", { name: "  " }));
    expect(bad.status).toBe(400);
  });
});

describe("POST /api/keys/[id]/rotate", () => {
  it("replaces the secret, keeps everything else, old secret stops validating", async () => {
    const { db, rotateRoute } = await boot();
    const created = await db.createApiKey("Rotate me", MACHINE);
    await db.updateApiKey(created.id, { access: { restricted: true, allow: ["openai/model-a"] } });

    const res = await rotateRoute.POST(json("POST"), params(created.id));
    expect(res.status).toBe(200);
    const { key } = await res.json();

    expect(key.id).toBe(created.id);
    expect(key.name).toBe("Rotate me");
    expect(key.isActive).toBe(true);
    expect(key.access).toEqual({ restricted: true, allow: ["openai/model-a"] });
    expect(key.createdAt).toBe(created.createdAt);
    expect(key.key).not.toBe(created.key);
    expect(key.key).toMatch(new RegExp(`^sk-${MACHINE}-[a-z0-9]{6}-[0-9a-f]{8}$`));

    expect(await db.validateApiKey(created.key)).toBe(false);
    expect(await db.validateApiKey(key.key)).toBe(true);
    expect(await db.getApiKeyByKey(created.key)).toBeNull();
    expect((await db.getApiKeyByKey(key.key)).id).toBe(created.id);
    expect((await db.getApiKeys()).length).toBe(1);
  });

  it("keeps a paused key paused", async () => {
    const { db, rotateRoute } = await boot();
    const created = await db.createApiKey("Paused", MACHINE);
    await db.updateApiKey(created.id, { isActive: false });
    const res = await rotateRoute.POST(json("POST"), params(created.id));
    const { key } = await res.json();
    expect(key.isActive).toBe(false);
    expect(await db.validateApiKey(key.key)).toBe(false);
  });

  it("404s on an unknown id", async () => {
    const { rotateRoute } = await boot();
    const res = await rotateRoute.POST(json("POST"), params("nope"));
    expect(res.status).toBe(404);
  });

  it("upgrades a legacy sk-{random8} key to the machine format", async () => {
    const { db } = await boot();
    const { getAdapter } = await import("@/lib/db/driver.js");
    const adapter = await getAdapter();
    adapter.run(
      `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
      ["legacy", "sk-abcdefgh", "Legacy", null, 1, "2026-01-01T00:00:00.000Z", 0, "[]"]
    );
    const rotated = await db.rotateApiKey("legacy", MACHINE);
    expect(rotated.key).toMatch(new RegExp(`^sk-${MACHINE}-`));
    expect(rotated.machineId).toBe(MACHINE);
    expect(rotated.name).toBe("Legacy");
    expect(await db.validateApiKey("sk-abcdefgh")).toBe(false);
  });

  it("rotateApiKey returns null for an unknown id and throws without machineId", async () => {
    const { db } = await boot();
    expect(await db.rotateApiKey("missing", MACHINE)).toBeNull();
    await expect(db.rotateApiKey("missing", "")).rejects.toThrow(/machineId/);
  });
});
