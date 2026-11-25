import { afterEach, beforeEach, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { reserveBudget, settleBudget, getBudgetBalance, BUDGET_REQUEST_TIMEOUT_MS } from "../../src/lib/db/repos/budgetLedger.js";
import { createNodeSqliteAdapter } from "../../src/lib/db/adapters/nodeSqliteAdapter.js";
import { TABLES, buildCreateTableSql } from "../../src/lib/db/schema.js";
import { meteredStream } from "../../src/sse/services/budgetResponse.js";
import { validateKeyPolicy } from "../../src/shared/utils/keyPolicy.js";

const policy = { provider: "openai-compatible-chat-fixture", model: "model", inputTokenCeiling: 10,
  tokenLimit: 70, costLimitMicros: 89, inputRate: 1000000, outputRate: 2000000, tariffDate: "2026-11-23" };
let db, dir, file;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "metered-"));
  file = path.join(dir, "fixture.sqlite");
  db = await createNodeSqliteAdapter(file);
  for (const t of ["apiKeys", "budgetReservations"]) db.exec(buildCreateTableSql(t, TABLES[t]));
  db.run("INSERT INTO apiKeys(id,key_ciphertext,createdAt,budget) VALUES('key-id','fixture','now',?)", [JSON.stringify(policy)]);
});
afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
const reserve = (id, p = policy) => reserveBudget(db, id, "key-id", p, 5).status;
const row = id => db.get("SELECT * FROM budgetReservations WHERE requestId=?", [id]);

it.each([
  ["lifetime", policy, 4],
  ["minute", { ...policy, tpmLimit: 30 }, 2],
  ["slots", { ...policy, concurrencyLimit: 1 }, 1],
])("serializes 32 attempts from four WAL connections against the %s limit", async (_, p, expected) => {
  const now = Date.now();
  db.run("UPDATE apiKeys SET budget=?", [JSON.stringify(p)]);
  const workers = Array.from({ length: 4 }, (_, index) => new Worker(new URL("../fixtures/budget-reservation-worker.mjs", import.meta.url), { workerData: { index, file, policy: p, now } }));
  try {
    await Promise.all(workers.map(w => once(w, "message")));
    const results = Promise.all(workers.map(w => once(w, "message")));
    workers.forEach(w => w.postMessage("start"));
    const statuses = (await results).flat(2);
    expect(statuses.filter(s => s === 200)).toHaveLength(expected);
    expect(statuses.filter(s => s === 429)).toHaveLength(32 - expected);
  } finally { await Promise.all(workers.map(w => w.terminate())); }
  db.close(); db = await createNodeSqliteAdapter(file);
  expect(reserveBudget(db, "after-restart", "key-id", p, 5, now).status).toBe(429);
});
it("rejects duplicate dispatch and settles exactly once with the reserved tariff", () => {
  expect(reserve("A")).toBe(200);
  expect(reserve("A")).toBe(409);
  db.run("UPDATE apiKeys SET budget=?", [JSON.stringify({ ...policy, outputRate: 9000000 })]);
  expect(reserve("old-policy")).toBe(403);
  expect(settleBudget(db, "A", { prompt_tokens: 3, completion_tokens: 2 })).toBe(true);
  expect(settleBudget(db, "A", { prompt_tokens: 0, completion_tokens: 0 })).toBe(false);
  expect(row("A")).toMatchObject({ reservedTokens: 15, reservedMicros: 20, actualMicros: 7, state: "settled" });
});
it.each([["tokenLimit",14],["costLimitMicros",19]])("enforces %s independently", (field,n) => {
  const p = { ...policy, [field]: n };
  db.run("UPDATE apiKeys SET budget=?", [JSON.stringify(p)]);
  expect(reserve("too-large", p)).toBe(429);
  expect(row("too-large")).toBeUndefined();
});
it("retains a full hold on cancellation after partial usage and ignores late callbacks", async () => {
  expect(reserve("cancel")).toBe(200);
  const input = new ReadableStream({ start(c) {
    c.enqueue(new TextEncoder().encode('data: {"choices":[],"usage":{"prompt_tokens":1,"completion_tokens":0}}\n\n'));
  } });
  const reader = meteredStream(input, usage => settleBudget(db, "cancel", usage)).getReader();
  await reader.read(); await reader.cancel();
  expect(settleBudget(db, "cancel", { prompt_tokens: 1, completion_tokens: 0 })).toBe(false);
  expect(row("cancel")).toMatchObject({ state: "unconfirmed", actualMicros: null, reservedMicros: 20 });
});
it.each([null, {prompt_tokens: 1}, {prompt_tokens: 2, completion_tokens: -1}, {prompt_tokens: 2, completion_tokens: 1, total_tokens: 2}])("does not invent a charge for missing or inconsistent usage", usage => {
  expect(reserve("missing")).toBe(200);
  settleBudget(db, "missing", usage);
  expect(row("missing")).toMatchObject({ state: "unconfirmed", actualMicros: null });
});
it("fails closed for an unverified tariff, expired key or independent-memory driver", () => {
  expect(validateKeyPolicy({ budget: {...policy, inputRate: -1} }).error).toBeTruthy();
  expect(validateKeyPolicy({ budget: {...policy, tariffDate: "2026-02-30"} }).error).toBeTruthy();
  expect(reserveBudget({ driver: "sql.js" }, "id", "key-id", policy, 5).status).toBe(503);
  db.run("UPDATE apiKeys SET expiresAt='2000-01-01T00:00:00Z'");
  expect(reserve("expired")).toBe(403);
});
it("records an upstream overrun in full and stops dispatch for the broken model contract", () => {
  expect(reserve("bad-provider")).toBe(200);
  expect(settleBudget(db, "bad-provider", { prompt_tokens: 11, completion_tokens: 2 })).toBe(true);
  expect(row("bad-provider")).toMatchObject({ state: "overrun", actualMicros: 15 });
  expect(reserve("do-not-send")).toBe(503);
});

it("reconciles only the admission minute and reports seconds to its UTC reset", () => {
  const p = { ...policy, tpmLimit: 20 };
  db.run("UPDATE apiKeys SET budget=?", [JSON.stringify(p)]);
  const now = Date.UTC(2030, 3, 1, 12, 59, 57, 100);
  const admit = (id, t) => reserveBudget(db, id, "key-id", p, 5, t);
  expect(admit("a", now).status).toBe(200);
  expect(admit("reject", now)).toEqual({status:429, code:"key_tpm_limit", retryAfter:3});
  settleBudget(db, "a", { prompt_tokens: 3, completion_tokens: 2 });
  expect(admit("b", now).status).toBe(200);
  expect(getBudgetBalance(db, "key-id", now)).toMatchObject({ minuteTokens:20, remainingMinuteTokens:0 });
  expect(admit("c", now + 2900).status).toBe(200);
  settleBudget(db, "b", { prompt_tokens: 0, completion_tokens: 0 });
  expect(getBudgetBalance(db, "key-id", now + 2900)).toMatchObject({ minuteTokens:15, remainingMinuteTokens:5 });
});
it("releases a cancelled or orphaned slot without refunding unknown lifetime usage", () => {
  const p = { ...policy, concurrencyLimit: 1 };
  db.run("UPDATE apiKeys SET budget=?", [JSON.stringify(p)]);
  const now = Date.now();
  const admit = (id, dt) => reserveBudget(db, id, "key-id", p, 5, now + dt);
  expect(admit("a", 0).status).toBe(200);
  expect(admit("deny", 1)).toEqual({ status:429, code:"key_concurrency_limit", retryAfter:1 });
  settleBudget(db, "a", null);
  expect(admit("crash", 2).status).toBe(200);
  expect(admit("deny2", BUDGET_REQUEST_TIMEOUT_MS).code).toBe("key_concurrency_limit");
  expect(admit("after-lease", BUDGET_REQUEST_TIMEOUT_MS + 31_000).status).toBe(200);
  expect(getBudgetBalance(db, "key-id", now + BUDGET_REQUEST_TIMEOUT_MS + 31_000)).toMatchObject({
    activeRequests:1, availableSlots:0, holds:3, heldTokens:45, heldMicros:60,
  });
});
it("rejects invalid time limits and a request larger than the whole minute without writing a hold", () => {
  for (const fields of [{tpmLimit:0}, {concurrencyLimit:1.2}, {concurrencyLimit:"2"}]) {
    expect(validateKeyPolicy({budget:{...policy, ...fields}}).error).toBeTruthy();
  }
  const p = { ...policy, tpmLimit: 14 };
  db.run("UPDATE apiKeys SET budget=?", [JSON.stringify(p)]);
  expect(reserveBudget(db, "large", "key-id", p, 5)).toEqual({ status:422, code:"request_exceeds_tpm_limit" });
  expect(getBudgetBalance(db, "key-id").requests).toBe(0);
});
