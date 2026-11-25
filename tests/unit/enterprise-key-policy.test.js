import { beforeAll, afterAll, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { admitKey } from "../../src/lib/db/repos/keyAdmission.js";
import { requestQuotaSummary } from "../../src/shared/utils/requestWindows.js";
import { validateKeyPolicy } from "../../src/shared/utils/keyPolicy.js";
import { expiryInput, expiryInstant } from "../../src/shared/utils/keyExpiryTime.js";

it("round-trips Istanbul wall time across UTC midnight with milliseconds", async () => {
  const stamp = "2030-12-31T22:30:09.123Z";
  const local = await expiryInput(stamp, "Europe/Istanbul");
  expect(local).toBe("2031-01-01T01:30:09.123");
  expect(await expiryInstant(local, "Europe/Istanbul", null)).toBe(stamp);
});

it("rejects skipped and repeated wall times, preserving a saved second occurrence", async () => {
  const zone = "America/New_York";
  await expect(expiryInstant("2027-03-14T02:30", zone)).rejects.toThrow();
  await expect(expiryInstant("2027-11-07T01:30", zone)).rejects.toThrow();
  const saved = "2027-11-07T06:30:00.000Z";
  expect(await expiryInstant("2027-11-07T01:30", zone, saved)).toBe(saved);
});

let repo, db, guard, create, update, dir;
const old = process.env.DATA_DIR;
const now = Date.UTC(2030, 1, 1);
beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "router-policy-"));
  process.env.DATA_DIR = dir;
  vi.resetModules();
  repo = await import("@/lib/db/index.js");
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  ({ proxy: guard } = await import("@/dashboardGuard.js"));
  ({ POST: create } = await import("@/app/api/keys/route.js"));
  ({ PUT: update } = await import("@/app/api/keys/[id]/route.js"));
});
afterAll(() => {
  db?.close(); delete global._dbAdapter;
  if (old === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = old;
  fs.rmSync(dir, { recursive: true, force: true });
});
const body = (data) => ({ json: async () => data });
function request(key, method = "POST", pathname = "/v1/chat/completions") {
  const nextUrl = new URL(pathname, "http://localhost");
  return { method, nextUrl, url: nextUrl.href, headers: new Headers({ authorization: "Bearer " + key }), cookies: { get: () => undefined } };
}
it("rejects invalid policies before writing the key", async () => {
  for (const policy of [{ rpmLimit: 0 }, { rpmLimit: 0.5 }, { rpmLimit: "4" }, { expiresAt: "2030-02-30T00:00:00Z" }]) {
    expect((await create(body({ name: "invalid", ...policy }))).status).toBe(400);
  }
  expect(await repo.getApiKeys()).toHaveLength(0);
  expect(validateKeyPolicy({ expiresAt: "2030-02-01T00:00:00Z" }).value.expiresAt).toBe("2030-02-01T00:00:00.000Z");
});
it("enforces API-created policy before forwarding on different public routes, with no POST charge for discovery", async () => {
  const res = await create(body({ name: "fixture", rpmLimit: 2 }));
  expect(res.status).toBe(201);
  const { key, id } = await res.json();
  expect((await guard(request(key, "GET", "/v1/models"))).status).toBe(200);
  expect((await guard(request(key))).status).toBe(200);
  expect((await guard(request(key, "POST", "/responses"))).status).toBe(200);
  const denied = await guard(request(key, "POST", "/api/v1beta/models/test:streamGenerateContent"));
  expect(denied.status).toBe(429);
  expect(denied.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
  expect(Number(denied.headers.get("retry-after"))).toBeGreaterThan(0);
  expect(await denied.text()).not.toContain(key);
  expect((await update(body({ expiresAt: "2020-01-01T00:00:00Z" }), { params: { id } })).status).toBe(200);
  const expired = await guard(request(key));
  expect(expired.status).toBe(401);
  expect(expired.headers.get("x-request-id")).toBeTruthy();
  expect(expired.headers.get("x-request-id")).not.toBe(denied.headers.get("x-request-id"));
  expect(db.get("SELECT COUNT(*) AS n FROM usageHistory").n).toBe(0);
  expect((await guard(request(key, "GET", "/v1/models"))).status).toBe(401);
  expect(await repo.validateApiKey(key)).toBe(false);
  const dump = await repo.exportDb();
  await repo.importDb(dump);
  expect(await repo.validateApiKey(key)).toBe(false);
  expect((await repo.getApiKeyById(id)).rpmLimit).toBe(2);
  expect((await update(body({ expiresAt: null, rpmLimit: null }), { params: { id } })).status).toBe(200);
  expect((await guard(request(key))).status).toBe(200);
});
it.each([
  ["minute","rpmLimit"], ["hour","hourlyRequestLimit"], ["day","dailyRequestLimit"], ["month","monthlyRequestLimit"],
])("admits seven of forty parallel calls with the %s window binding", async (window, field) => {
  const { key, id } = await repo.createApiKey("workers", "fixture", {
    rpmLimit: 20, hourlyRequestLimit: 20, dailyRequestLimit: 20, monthlyRequestLimit: 20, [field]: 7,
  });
  const workers = Array.from({ length: 4 }, () => new Worker(new URL("../fixtures/key-admission-worker.mjs", import.meta.url), {
    workerData: { file: path.join(dir, "db/data.sqlite"), key, now },
  }));
  try {
    await Promise.all(workers.map(w => once(w, "message")));
    const results = Promise.all(workers.map(w => once(w, "message")));
    workers.forEach(w => w.postMessage("start"));
    const statuses = (await results).flat(2);
    expect(statuses.filter(s => s === 200)).toHaveLength(7);
    expect(statuses.filter(s => s === 429)).toHaveLength(33);
    const summary = requestQuotaSummary(db.get("SELECT * FROM apiKeys WHERE id=?", [id]), now);
    expect(Object.values(summary).map(w => w.used)).toEqual([7,7,7,7]);
    const reset = Date.parse(summary[window].resetsAt);
    expect(admitKey(db, key, reset-1)).toEqual({ status:429, windows:[window], retryAfter:1 });
    expect(admitKey(db, key, reset).status).toBe(200);
  } finally { await Promise.all(workers.map(w => w.terminate())); }
});

it("uses the last reset when multiple limits bind; honors leap day and year rollover", async () => {
  const { key } = await repo.createApiKey("calendar","fixture",{ hourlyRequestLimit:1, dailyRequestLimit:1, monthlyRequestLimit:1 });
  const feb = Date.parse("2028-02-28T23:59:59.500Z");
  expect(admitKey(db,key,feb).status).toBe(200);
  expect(admitKey(db,key,feb)).toEqual({status:429, windows:["hour","day","month"], retryAfter:86401});
  expect(admitKey(db,key,feb+500)).toEqual({status:429, windows:["month"], retryAfter:86400});
  expect(admitKey(db,key,Date.parse("2028-03-01T00:00:00Z")).status).toBe(200);
  const dec = Date.parse("2028-12-31T23:59:59Z");
  expect(admitKey(db,key,dec).status).toBe(200);
  expect(admitKey(db,key,dec).retryAfter).toBe(1);
  expect(admitKey(db,key,dec+1000).status).toBe(200);
  expect(admitKey(db,key,dec).status).toBe(429);
});
it("preserves counters on policy edits and backup round-trip; rejects malformed imports atomically", async () => {
  const res = await create(body({name:"durable", monthlyRequestLimit:1}));
  const {key,id} = await res.json();
  expect(admitKey(db,key,now).status).toBe(200);
  for (const patch of [{monthlyRequestLimit:2}, {dailyRequestLimit:5}]) {
    expect((await update(body(patch),{params:{id}})).status).toBe(200);
  }
  expect(admitKey(db,key,now).status).toBe(200);
  const dump = await repo.exportDb();
  await repo.importDb(dump);
  expect(admitKey(db,key,now).windows).toEqual(["month"]);
  const bad = structuredClone(dump);
  bad.apiKeys.find(k=>k.id===id).requestCounters.month.used = -1;
  await expect(repo.importDb(bad)).rejects.toThrow("Invalid request counter");
  expect(admitKey(db,key,now).windows).toEqual(["month"]);
  expect((await update(body({monthlyRequestLimit:null}),{params:{id}})).status).toBe(200);
  expect(admitKey(db,key,now).status).toBe(200);
  expect(db.get("SELECT monthlyRequests FROM apiKeys WHERE id=?", [id]).monthlyRequests).toBe(2);
});
it("rejects invalid request limits at the management API", async () => {
  for (const patch of [{hourlyRequestLimit:0}, {dailyRequestLimit:1.1}, {monthlyRequestLimit:"8"}]) {
    expect((await create(body({name:"invalid", ...patch}))).status).toBe(400);
  }
});

it("validates ownership on POST and PUT; summary and backup apply distinct projections", async () => {
  const metadata = { description: "D".repeat(500), project: "P".repeat(120), owner: "O".repeat(120) };
  const created = await create(body({ name: "details", ...metadata }));
  expect(created.status).toBe(201);
  const { id, key } = await created.json();
  for (const [field, valid] of Object.entries(metadata)) {
    for (const invalid of [valid + "x", 1, {}]) {
      expect((await create(body({ name: "bad", [field]: invalid }))).status).toBe(400);
      expect((await update(body({ [field]: invalid }), { params: { id } })).status).toBe(400);
    }
  }
  const backup = await repo.exportDb();
  expect(backup.apiKeys.find(k => k.id === id)).toMatchObject(metadata);
  await repo.importDb(backup);
  expect(await repo.getApiKeyById(id)).toMatchObject({ ...metadata, key });
  const result = await update(body({ project: " Blue ", owner: "ops@example.org", description: "uses sk-sensitive" }), { params: { id } });
  expect(result.status).toBe(200);
  expect((await repo.getApiKeys()).find(k => k.id === id)).toMatchObject({ project: "Blue", owner: "ops@example.org", description: "uses sk-sensitive" });
  const summary = (await repo.getApiKeySummaries()).find(k => k.id === id);
  expect(summary).toEqual({ id, name: "details", owner: null, project: "Blue", isActive: true, expiresAt: null, createdAt: expect.any(String) });
  expect((await repo.exportDb()).apiKeys.find(k => k.id === id)).toMatchObject({ owner: null, project: "Blue", description: null });
  await update(body({ project: null }), { params: { id } });
  expect(await repo.getApiKeyById(id)).toMatchObject({ project: null, owner: "ops@example.org" });
});
