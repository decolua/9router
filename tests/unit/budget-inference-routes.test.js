import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { createNodeSqliteAdapter } from "../../src/lib/db/adapters/nodeSqliteAdapter.js";

const fake = vi.hoisted(() => ({ fetch: vi.fn(), url: vi.fn(() => "https://fixture.invalid/v1/chat/completions") }));
vi.mock("open-sse/executors/index.js", () => ({ getExecutor: () => ({ buildUrl: fake.url, buildHeaders: () => ({}) }) }));
vi.mock("open-sse/utils/proxyFetch.js", async original => ({ ...await original(), proxyAwareFetch: fake.fetch }));

const dir = mkdtempSync(join(tmpdir(), "budget-routes-"));
const connections = [], connectionScope = new AsyncLocalStorage();
const provider = "openai-compatible-chat-fixture", model = provider + "/fixture";
const budget = { provider, model: "fixture", inputTokenCeiling: 10, tokenLimit: 70, costLimitMicros: 89,
  inputRate: 1000000, outputRate: 2000000, tariffDate: "2026-11-23" };
const messages = "/v1/messages", responses = "/v1/responses";
const usage = { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 };
const json = { id: "chatcmpl-fixture", model: "fixture", choices: [{ index: 0, message: { role: "assistant", content: "hello" }, finish_reason: "stop" }], usage };
const delta = { model: "fixture", choices: [{ index: 0, delta: { content: "hello" } }] };
const frame = event => "data: " + JSON.stringify(event) + "\r\n\r\n";
const trailer = frame({ choices: [], usage });
const end = frame({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) + trailer + "data: [DONE]\r\n\r\n";
const sse = body => new Response(body, { headers: { "content-type": "text/event-stream" } });
let db, repo, guard, routes;
beforeAll(async () => {
  vi.stubEnv("DATA_DIR", dir);
  const driver = await import("@/lib/db/driver.js");
  db = await driver.getAdapter();
  expect(db.driver).not.toBe("sql.js");
  for (let i = 0; i < 4; i++) connections.push(await createNodeSqliteAdapter(join(dir, "db/data.sqlite")));
  vi.spyOn(driver, "getAdapter").mockImplementation(async () => connectionScope.getStore() ?? db);
  repo = await import("@/lib/db/index.js");
  await repo.createProviderConnection({ provider, authType: "apikey", name: "fixture", apiKey: "fixture",
    providerSpecificData: { apiType: "chat", baseUrl: "https://fixture.invalid/v1" } });
  ({ proxy: guard } = await import("@/dashboardGuard.js"));
  routes = { [messages]: (await import("@/app/api/v1/messages/route.js")).POST,
    [responses]: (await import("@/app/api/v1/responses/route.js")).POST };
}, 30000);
beforeEach(() => { fake.fetch.mockReset(); fake.url.mockClear(); });
afterAll(() => {
  vi.restoreAllMocks();
  connections.forEach(c => c.close()); db?.close(); delete global._dbAdapter;
  vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true });
});
const makeKey = (policy = {}) => repo.createApiKey("fixture", "machine", { budget, ...policy });
function request(path, key, body) {
  return new NextRequest("http://localhost" + path, { method: "POST", headers: path === messages ?
    { "x-api-key": key.key } : { authorization: "Bearer " + key.key }, body: JSON.stringify(body) });
}
async function post(path, key, fields = {}) {
  const body = path === messages ? { system: "test", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], max_tokens: 5 } :
    { instructions: "test", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }], max_output_tokens: 5 };
  const req = request(path, key, { model, ...body, ...fields });
  const allowed = await guard(req);
  return allowed.status === 200 ? routes[path](req) : allowed;
}
async function check(response, key, path, settled) {
  const requestId = response.headers.get("x-request-id");
  expect(requestId).toBeTruthy();
  expect(db.all("SELECT requestId,state,actualMicros,reservedMicros FROM budgetReservations WHERE keyId=?", [key.id]))
    .toEqual([{ requestId, state: settled ? "settled" : "unconfirmed", actualMicros: settled ? 7 : null, reservedMicros: 20 }]);
  await vi.waitFor(() => expect(db.all("SELECT endpoint,requestId,cost,promptTokens,completionTokens FROM usageHistory WHERE requestId=?", [requestId]))
    .toEqual([{ endpoint: path, requestId, cost: settled ? 7e-6 : 0, promptTokens: settled ? 3 : 0, completionTokens: settled ? 2 : 0 }]));
  expect(fake.fetch).toHaveBeenCalledTimes(1);
}

describe.each([messages, responses])("budgeted %s", path => {
  it("translates JSON and settles once at the reserved tariff", async () => {
    const key = await makeKey();
    fake.fetch.mockResolvedValueOnce(Response.json(json));
    const res = await post(path, key);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject(path === messages ? { type: "message", content: [{ text: "hello" }] } :
      { object: "response", output: [{ content: [{ text: "hello" }] }] });
    expect(JSON.parse(fake.fetch.mock.calls[0][1].body)).toEqual({ model: "fixture", max_tokens: 5,
      messages: [{ role: "system", content: "test" }, { role: "user", content: "hi" }] });
    await check(res, key, path, true);
  });

  it("delivers native SSE and settles the raw usage trailer once", async () => {
    const key = await makeKey();
    fake.fetch.mockResolvedValueOnce(sse(frame(delta) + end));
    const res = await post(path, key, { stream: true });
    const body = await res.text();
    expect(body).toContain(path === messages ? "event: message_stop" : "event: response.completed");
    expect(body).toContain("hello");
    expect(body).toContain('"output_tokens":2');
    expect(JSON.parse(fake.fetch.mock.calls[0][1].body).stream_options).toEqual({ include_usage: true });
    await check(res, key, path, true);
  });

  it.each(["cancel", "disconnect", "truncated", "missing JSON usage"])("keeps one hold on %s", async mode => {
    const key = await makeKey();
    let source;
    const cancel = vi.fn();
    fake.fetch.mockResolvedValueOnce(mode === "missing JSON usage" ? Response.json({ ...json, usage: undefined }) :
      sse(new ReadableStream({ start(c) { source = c; c.enqueue(new TextEncoder().encode(frame(delta) + trailer)); }, cancel })));
    const res = await post(path, key, { stream: mode !== "missing JSON usage" });
    expect(res.status).toBe(200);
    if (mode !== "missing JSON usage") {
      const reader = res.body.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain("hello");
      if (mode === "cancel") { await reader.cancel(); expect(cancel).toHaveBeenCalledOnce(); }
      else {
        if (mode === "truncated") source.close(); else source.error(new Error("fixture disconnect"));
        await expect(reader.read()).rejects.toThrow();
      }
    }
    await check(res, key, path, false);
  });

  it.each(["balance", "allow list", "combo", "cap"])("rejects %s before dispatch or period consumption", async mode => {
    const policy = mode === "balance" ? { budget: { ...budget, costLimitMicros: 19 } } :
      mode === "allow list" ? { access: { restricted: true, allow: [provider + "/other"] } } : {};
    const key = await makeKey({ hourlyRequestLimit: 1, ...policy });
    const fields = mode === "cap" ? { [path === messages ? "max_tokens" : "max_output_tokens"]: undefined } :
      mode === "combo" ? { model: "team-combo" } : {};
    const res = await post(path, key, fields);
    expect(res.status).toBe(mode === "balance" ? 429 : mode === "cap" ? 400 : 403);
    expect(db.get("SELECT hourlyRequests FROM apiKeys WHERE id=?", [key.id]).hourlyRequests).toBe(0);
    expect(db.all("SELECT requestId FROM budgetReservations WHERE keyId=?", [key.id])).toHaveLength(0);
    expect(fake.url).not.toHaveBeenCalled(); expect(fake.fetch).not.toHaveBeenCalled();
  });

  it.each([["balance", 4], ["hour", 3], ["tpm", 2], ["slots", 1]])("limits 32 requests across four WAL connections by %s", async (limit, count) => {
    const key = await makeKey({ hourlyRequestLimit: limit === "hour" ? count : 32,
      budget: { ...budget, ...(limit === "slots" && { concurrencyLimit: count }), ...(limit === "tpm" && { tpmLimit: count * 15 }) } });
    fake.fetch.mockImplementation(async () => sse(frame(delta) + end));
    // Pin admission within one UTC minute even when the test starts at :59.999.
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 10, 24, 8, 30, 10));
    let replies;
    try {
      replies = await Promise.all(Array.from({ length: 32 }, (_, i) =>
        connectionScope.run(connections[i % 4], () => post(path, key, { stream: true }))));
    } finally { clock.mockRestore(); }
    expect(replies.filter(r => r.status === 200)).toHaveLength(count);
    expect(replies.filter(r => r.status === 429)).toHaveLength(32 - count);
    expect(fake.fetch).toHaveBeenCalledTimes(count);
    expect(db.get("SELECT hourlyRequests FROM apiKeys WHERE id=?", [key.id]).hourlyRequests).toBe(count);
    expect(db.get("SELECT COUNT(*) AS n, SUM(reservedMicros) AS held FROM budgetReservations WHERE keyId=? AND state='pending'", [key.id]))
      .toEqual({ n: count, held: count * 20 });
    await Promise.all(replies.map(r => r.text()));
  });
});

it.each(["embeddings", "images/generations", "audio/transcriptions", "videos/generations", "search", "web/fetch", "messages/count_tokens", "responses/compact"])(
  "explicitly blocks %s at both public and rewritten paths", async suffix => {
    const key = await makeKey();
    for (const prefix of ["/v1/", "/api/v1/"]) {
      const res = await guard(request(prefix + suffix, key, {}));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "Budgeted keys support chat completions, messages and responses endpoints" });
    }
    expect(fake.fetch).not.toHaveBeenCalled();
  });


it.each(["/v1/videos/fixture", "/api/v1/audio/voices"])("blocks provider reads without charging ordinary keys at %s", async path => {
  const limited = await makeKey(), ordinary = await repo.createApiKey("ordinary", "machine", { rpmLimit: 1 });
  for (const method of ["GET", "HEAD"]) {
    for (const [key, status] of [[limited, 403], [ordinary, 200]]) {
      const res = await guard(new NextRequest("http://localhost" + path, { method, headers: { authorization: "Bearer " + key.key } }));
      expect(res.status).toBe(status);
    }
  }
  expect(db.get("SELECT rpmUsed FROM apiKeys WHERE id=?", [ordinary.id]).rpmUsed).toBe(0);
});
