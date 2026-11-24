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

// The Cost limit is independent of Restrict access and of pricing: it can always be saved.
// Pricing only decides whether it is ENFORCED (limitStatus.effective), shown greyed in the UI.
describe("PUT /api/keys/[id] limit", () => {
  it("rejects an invalid limit with 400", async () => {
    const k = await restrictedKey(["openai/gpt-4"]);
    expect((await put(k.id, { limit: { usd: -1, window: "day" } })).status).toBe(400);
    expect((await put(k.id, { limit: { usd: 5, window: "week" } })).status).toBe(400);
    expect((await put(k.id, { limit: "5" })).status).toBe(400);
  });
  it("accepts a limit on an UNRESTRICTED key, saved but not effective", async () => {
    const k = await db.createApiKey("open", "machine-1");
    const res = await put(k.id, { limit: { usd: 5, window: "day" } });
    expect(res.status).toBe(200);
    const { key } = await res.json();
    expect(key.limit).toEqual({ usd: 5, window: "day" });
    expect(key.limitStatus.effective).toBe(false);
    expect(key.limitStatus.unbounded).toBe(true);
  });
  it("accepts a limit while a reachable model is unpriced, saved but not effective, models named", async () => {
    const k = await restrictedKey(["acme/no-such-model"]);
    const res = await put(k.id, { limit: { usd: 5, window: "day" } });
    expect(res.status).toBe(200);
    const { key } = await res.json();
    expect(key.limit).toEqual({ usd: 5, window: "day" });
    expect(key.limitStatus.effective).toBe(false);
    expect(key.limitStatus.unpriced).toEqual(["acme/no-such-model"]);
  });
  it("accepts a limit on a fully priced restricted key and it is effective", async () => {
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
  it("turning Restrict access off keeps the limit, which stops being effective; turning it on again restores it", async () => {
    const k = await restrictedKey(["openai/gpt-4"]);
    await put(k.id, { limit: { usd: 5, window: "day" } });
    let { key } = await (await put(k.id, { access: { restricted: false, allow: [] } })).json();
    expect(key.limit).toEqual({ usd: 5, window: "day" });
    expect(key.limitStatus.effective).toBe(false);
    ({ key } = await (await put(k.id, { access: { restricted: true, allow: ["openai/gpt-4"] } })).json());
    expect(key.limit).toEqual({ usd: 5, window: "day" });
    expect(key.limitStatus.effective).toBe(true);
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
  it("an override price makes the saved limit effective", async () => {
    const k = await restrictedKey(["acme/no-such-model"]);
    await put(k.id, { limit: { usd: 5, window: "day" } });
    await db.updatePricing({ acme: { "no-such-model": { input: 1, output: 2 } } });
    const { keys } = await (await keysList.GET()).json();
    expect(keys.find((x) => x.id === k.id).limitStatus.effective).toBe(true);
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
