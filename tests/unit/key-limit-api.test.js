// tests/unit/key-limit-api.test.js
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

let tempDir;
let db;
let keysId; // route module for /api/keys/[id]
let keysList; // route module for /api/keys

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-key-limit-api-"));
  process.env.DATA_DIR = tempDir;
  delete global._dbAdapter;
  vi.resetModules();
  db = await import("@/lib/db/index.js");
  await db.initDb();
  keysId = await import("../../src/app/api/keys/[id]/route.js");
  keysList = await import("../../src/app/api/keys/route.js");
});

afterEach(() => {
  delete process.env.DATA_DIR;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const put = (id, body) =>
  keysId.PUT(new Request(`http://localhost/api/keys/${id}`, { method: "PUT", body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

async function restrictedKey(allow) {
  const k = await db.createApiKey("k", "machine-1");
  await db.updateApiKey(k.id, { access: { restricted: true, allow } });
  return k;
}

describe("PUT /api/keys/[id] limit", () => {
  it("rejects an invalid limit with 400", async () => {
    const k = await restrictedKey(["openai/gpt-4"]);
    const res = await put(k.id, { limit: { usd: -1, window: "day" } });
    expect(res.status).toBe(400);
  });
  it("rejects a limit on an unrestricted key with 400 (it can reach every model)", async () => {
    const k = await db.createApiKey("open", "machine-1");
    const res = await put(k.id, { limit: { usd: 5, window: "day" } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/unrestricted|every model/i);
  });
  it("rejects a limit when a reachable model is unpriced and names it", async () => {
    const k = await restrictedKey(["acme/no-such-model"]);
    const res = await put(k.id, { limit: { usd: 5, window: "day" } });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("acme/no-such-model");
  });
  it("accepts a limit on a fully priced restricted key and returns it with a status", async () => {
    const k = await restrictedKey(["openai/gpt-4"]);
    const res = await put(k.id, { limit: { usd: 5, window: "day" } });
    expect(res.status).toBe(200);
    const { key } = await res.json();
    expect(key.limit).toEqual({ usd: 5, window: "day" });
    expect(key.limitStatus.effective).toBe(true);
  });
  it("clearing a limit with null is always allowed", async () => {
    const k = await restrictedKey(["openai/gpt-4"]);
    await put(k.id, { limit: { usd: 5, window: "day" } });
    const res = await put(k.id, { limit: null });
    expect(res.status).toBe(200);
    expect((await res.json()).key.limit).toBeNull();
  });
  it("changing access to an unpriced model keeps the limit but the status says it is not effective", async () => {
    const k = await restrictedKey(["openai/gpt-4"]);
    await put(k.id, { limit: { usd: 5, window: "day" } });
    const res = await put(k.id, { access: { restricted: true, allow: ["openai/gpt-4", "acme/no-such-model"] } });
    expect(res.status).toBe(200);
    const { key } = await res.json();
    expect(key.limit).toEqual({ usd: 5, window: "day" });
    expect(key.limitStatus.effective).toBe(false);
    expect(key.limitStatus.unpriced).toEqual(["acme/no-such-model"]);
  });
  it("an override price makes a previously unpriced model eligible", async () => {
    await db.updatePricing({ acme: { "no-such-model": { input: 1, output: 2 } } });
    const k = await restrictedKey(["acme/no-such-model"]);
    const res = await put(k.id, { limit: { usd: 5, window: "day" } });
    expect(res.status).toBe(200);
  });
});

describe("GET /api/keys", () => {
  it("returns limit and limitStatus per key", async () => {
    const k = await restrictedKey(["openai/gpt-4"]);
    await put(k.id, { limit: { usd: 5, window: "month" } });
    const list = await (await keysList.GET()).json();
    const listed = list.keys.find((x) => x.id === k.id);
    expect(listed.limit).toEqual({ usd: 5, window: "month" });
    expect(listed.limitStatus.eligible).toBe(true);
  });
});
