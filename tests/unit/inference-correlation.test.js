import { it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fake = vi.hoisted(() => ({ execute: vi.fn(), budget: vi.fn(), refresh: vi.fn() }));
vi.mock("open-sse/executors/index.js", () => ({ getExecutor: () => ({
  execute: fake.execute, refreshCredentials: fake.refresh, buildUrl: () => "https://fixture.invalid", buildHeaders: () => ({}),
}) }));
vi.mock("open-sse/utils/proxyFetch.js", async original => ({ ...await original(), proxyAwareFetch: fake.budget }));

const dir = mkdtempSync(join(tmpdir(), "inference-correlation-"));
let db, repo, post, first, second;
const provider = "openai-compatible-chat-fixture";
const policy = { provider, model: "model", inputTokenCeiling: 10, tokenLimit: 100, costLimitMicros: 100,
  inputRate: 1000000, outputRate: 2000000, tariffDate: "2026-11-23" };
const usage = { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 };
const upstream = stream => stream ? new Response([
  'data: {"choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":null}]}',
  'data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
  'data: '+JSON.stringify({ choices: [], usage }), "data: [DONE]", "",
].join("\n\n"), { headers: { "content-type":"text/event-stream" } }) :
  Response.json({ model: "model", choices: [{ index: 0, message: { role:"assistant", content:"hello" }, finish_reason:"stop" }], usage });
const request = (stream, headers={}, model=provider+"/model") => new Request("http://localhost/v1/chat/completions", { method:"POST", headers,
  body: JSON.stringify({ model, messages:[{ role:"user", content:"hi" }], stream, max_tokens:5 }) });
const rows = id => db.all("SELECT * FROM usageHistory WHERE requestId=?", [id]);
beforeAll(async () => {
  vi.stubEnv("DATA_DIR", dir);
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  repo = await import("@/lib/db/index.js");
  await repo.updateSettings({ requireApiKey: false, enableObservability: true, observabilityBatchSize: 1 });
  const conn = name => repo.createProviderConnection({ provider, authType:"apikey", name, apiKey:"fake-"+name,
    providerSpecificData:{ apiType:"chat", baseUrl:"https://fixture.invalid" } });
  first = await conn("first"); second = await conn("second");
  post = (await import("@/app/api/v1/chat/completions/route.js")).POST;
}, 30000);
afterAll(() => { db?.close(); delete global._dbAdapter; vi.unstubAllEnvs(); rmSync(dir, { recursive:true, force:true }); });

it("correlates concurrent JSON and SSE, validates separate client IDs and joins request details", async () => {
  fake.execute.mockImplementation(async ({ stream }) => ({ response:upstream(stream), url:"fixture", headers:{}, transformedBody:{} }));
  const responses = await Promise.all([post(request(false, { "X-Request-Id":"client:12345" })), post(request(true, { "X-Request-Id":"bad id!" }))]);
  const ids = responses.map(r => r.headers.get("x-request-id"));
  expect(new Set(ids).size).toBe(2);
  expect(responses.map(r => r.status)).toEqual([200,200]);
  expect(await responses[0].json()).toHaveProperty("choices");
  expect(await responses[1].text()).toContain("[DONE]");
  for (const [i,id] of ids.entries()) {
    expect(id).toMatch(/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/);
    await vi.waitFor(() => expect(rows(id)).toHaveLength(1));
    const row = rows(id)[0], meta = JSON.parse(row.meta);
    expect(meta).toMatchObject({ finalConnectionId: row.connectionId, attempts:1, fallbacks:0, errorCategory:null });
    expect(meta.clientRequestId).toBe(i ? undefined : "client:12345");
    await vi.waitFor(() => expect(db.get("SELECT id FROM requestDetails WHERE id=?", [id])?.id).toBe(id));
    const history = await (await import("@/app/api/usage/history/route")).GET(new Request("http://localhost/api/usage/history?requestId="+id));
    expect((await history.json()).map(r => r.requestId)).toEqual([id]);
  }
});

it("least-connections sends three overlapping requests to three accounts", async () => {
  const third = await repo.createProviderConnection({ provider, authType:"apikey", name:"third", apiKey:"fake",
    providerSpecificData: { apiType:"chat", baseUrl:"https://fixture.invalid" } });
  await repo.updateSettings({ providerStrategies: { [provider]: { fallbackStrategy: "least-connections" } } });
  const seats = [], gate = Promise.withResolvers();
  fake.execute.mockImplementation(async ({ credentials }) => {
    seats.push(credentials.connectionId);
    await gate.promise;
    return { response: upstream(false), url:"fixture", headers:{}, transformedBody:{} };
  });
  const pending = Promise.all(Array.from({length:3}, () => post(request(false))));
  try {
    await vi.waitFor(() => expect(seats).toHaveLength(3));
    expect(new Set(seats)).toEqual(new Set([first.id, second.id, third.id]));
  } finally {
    gate.resolve();
    expect((await pending).map(r => r.status)).toEqual([200,200,200]);
    await repo.updateSettings({ providerStrategies: {} });
    await repo.deleteProviderConnection(third.id);
  }
});

it("weighted 3:1 stays smooth across 400 selections and skips ineligible accounts", async () => {
  const { getProviderCredentials } = await import("@/sse/services/auth.js");
  const pick = async () => (await getProviderCredentials(provider, null, "model"))?.connectionId;
  await repo.updateSettings({ providerStrategies: { [provider]: { fallbackStrategy: "weighted" } } });
  await repo.updateProviderConnection(first.id, { weight:3 });
  try {
    const seats = [];
    for (let i=0; i<400; i++) seats.push(await pick());
    expect(seats.filter(id => id === first.id)).toHaveLength(300);
    expect(seats.filter(id => id === second.id)).toHaveLength(100);
    for (let i=0; i<=396; i++) expect(seats.slice(i,i+4).filter(id => id === second.id)).toHaveLength(1);
    const future = new Date(Date.now()+60000).toISOString();
    for (const block of [{rateLimitedUntil:future}, {modelLock___all:future, modelLock_model:"2000-01-01"},
      {isActive:false}, {observedErrorAt:new Date().toISOString(), lastErrorCategory:"auth_invalid", lastSuccessAt:null}]) {
      await repo.updateProviderConnection(first.id, block);
      for (let i=0; i<4; i++) expect(await pick()).toBe(second.id);
      await repo.updateProviderConnection(first.id, {isActive:true, testStatus:"active"});
    }
    expect([await pick(), await pick()]).toContain(first.id);
  } finally {
    await repo.updateProviderConnection(first.id, {weight:1, isActive:true, testStatus:"active"});
    await repo.updateSettings({ providerStrategies: {} });
  }
});

it.each([false,true])("never retries after client reads first stream bytes (combo=%s)", async combo => {
  if (combo) await repo.createCombo({name:"stream-boundary", models:[provider+"/model",provider+"/other"]});
  let source;
  const body = new ReadableStream({start(controller) {
    source = controller;
    controller.enqueue(new TextEncoder().encode('data: {"choices":[{"index":0,"delta":{"content":"first"}}]}\n\n'));
  }});
  fake.execute.mockClear().mockResolvedValue({response:new Response(body, {headers:{"content-type":"text/event-stream"}}), url:"fixture", headers:{}});
  const response = await post(request(true, {}, combo ? "stream-boundary" : provider+"/model")), id=response.headers.get("x-request-id");
  const { getPendingCount } = await import("@/lib/db/repos/usageRepo.js");
  const reader=response.body.getReader();
  const firstChunk = await reader.read();
  expect(firstChunk.value.byteLength).toBeGreaterThan(0);
  expect(getPendingCount(first.id)).toBe(1);
  source.error(new Error("socket hang up"));
  try { while (!(await reader.read()).done) { /* read terminal frame */ } } catch { /* error may propagate */ }
  await vi.waitFor(() => expect(rows(id)).toHaveLength(1));
  expect(JSON.parse(rows(id)[0].meta)).toMatchObject({attempts:1, fallbacks:0});
  expect(fake.execute).toHaveBeenCalledTimes(1);
  expect(getPendingCount(first.id)).toBe(0);
});

it("keeps one budget reservation and one charge through an explicit 429 fallback", async () => {
  const key = await repo.createApiKey("fallback","machine", {budget:policy});
  fake.budget.mockClear().mockResolvedValueOnce(Response.json({error:"quota exceeded"}, {status:429})).mockResolvedValueOnce(upstream(false));
  try {
    const response = await post(request(false, {authorization:"Bearer "+key.key}));
    const id = response.headers.get("x-request-id");
    expect(response.status).toBe(200);
    expect(fake.budget).toHaveBeenCalledTimes(2);
    expect(db.all("SELECT state,actualMicros FROM budgetReservations WHERE requestId=?", [id])).toEqual([{state:"settled",actualMicros:7}]);
    await vi.waitFor(() => expect(rows(id)).toHaveLength(1));
    expect(JSON.parse(rows(id)[0].meta)).toMatchObject({attempts:2, fallbacks:1, finalConnectionId:second.id});
    expect(rows(id)[0].cost).toBe(7e-6);
    expect(JSON.parse(rows(id)[0].meta).pricing).toEqual({source:"user",version:policy.tariffDate});
  } finally { await repo.updateProviderConnection(first.id,{testStatus:"active"}); }
});

it.each([401, 408, 503, "timeout", 400])("routes account rejection %s without retrying a bad request", async status => {
  const seats = [];
  fake.refresh.mockResolvedValue(null);
  fake.execute.mockImplementation(async ({credentials}) => {
    seats.push(credentials.connectionId);
    if (seats.length === 1 && status === "timeout") throw Object.assign(new Error("timed out"), {code:"ETIMEDOUT"});
    return { response: seats.length > 1 ? upstream(false) : Response.json({error:"invalid input"}, {status}),
      url:"fixture", headers:{}, transformedBody:{} };
  });
  try {
    const response = await post(request(false));
    const rotate = status !== 400;
    expect(response.status).toBe(rotate ? 200 : 400);
    expect(seats).toEqual(rotate ? [first.id, second.id] : [first.id]);
  } finally { await repo.updateProviderConnection(first.id, {testStatus:"active"}); }
});

it("keeps one uncertain reservation and never replays a metered 503", async () => {
  const key = await repo.createApiKey("uncertain","machine", {budget:policy});
  fake.budget.mockClear().mockResolvedValueOnce(Response.json({error:"unavailable"}, {status:503}));
  try {
    const response = await post(request(false, {authorization:"Bearer "+key.key}));
    expect(response.status).toBe(503);
    expect(fake.budget).toHaveBeenCalledTimes(1);
    const records = db.all("SELECT state FROM budgetReservations WHERE requestId=?", [response.headers.get("x-request-id")]);
    expect(records).toEqual([{state:"unconfirmed"}]);
  } finally { await repo.updateProviderConnection(first.id,{testStatus:"active"}); }
});

it("validates and persists provider routing controls without overwriting other provider options", async () => {
  const { PUT } = await import("@/app/api/providers/[id]/route");
  const { PATCH } = await import("@/app/api/settings/route");
  const save = body => new Request("http://localhost/api/settings", {method:"PATCH", body:JSON.stringify(body)});
  const weight = n => PUT(save({weight:n}),{params:Promise.resolve({id:first.id})});
  for (const n of [0,101,1.5,"3"]) expect((await weight(n)).status).toBe(400);
  expect((await weight(100)).status).toBe(200);
  expect((await repo.getProviderConnectionById(first.id)).weight).toBe(100);
  await repo.updateSettings({providerStrategies:{[provider]:{proxyPoolId:"keep"}}});
  const set = strategy => PATCH(save({providerRouting:{provider,strategy}}));
  expect((await set("unknown")).status).toBe(400);
  expect((await set("weighted")).status).toBe(200);
  expect((await repo.getSettings()).providerStrategies[provider]).toEqual({fallbackStrategy:"weighted",proxyPoolId:"keep"});
  expect((await set("")).status).toBe(200);
  expect((await repo.getSettings()).providerStrategies[provider]).toEqual({proxyPoolId:"keep"});
  await weight(1);
  await repo.updateSettings({providerStrategies:{}});
});

it("one usage row after 429 then second connection success", async () => {
  fake.execute.mockImplementation(async ({ credentials,stream }) => ({
    response: credentials.connectionId === first.id ? Response.json({ error:"too many requests" }, { status:429, headers:{"retry-after":"30"} }) : upstream(stream),
    headers:{}, url:"fixture", transformedBody:{},
  }));
  const response = await post(request(false));
  expect(response.status).toBe(200);
  const id = response.headers.get("x-request-id");
  await vi.waitFor(() => expect(rows(id)).toHaveLength(1));
  expect(JSON.parse(rows(id)[0].meta)).toMatchObject({ attempts:2, fallbacks:1, finalConnectionId:second.id, errorCategory:null });
  const locked = await repo.getProviderConnectionById(first.id);
  expect(locked.lastErrorCategory).toBe("rate_limited");
  const remaining = Date.parse(locked.modelLock___all) - Date.now();
  expect(remaining).toBeGreaterThan(28000);
  expect(remaining).toBeLessThanOrEqual(30000);
});

it.each([false,true])("joins settled tariff, usage and reservation for stream=%s", async stream => {
  const key = await repo.createApiKey("fixture","machine", { budget:policy });
  fake.budget.mockResolvedValueOnce(upstream(stream));
  const response = await post(request(stream, { authorization:"Bearer "+key.key }));
  expect(response.status).toBe(200);
  await response.text();
  const id = response.headers.get("x-request-id");
  await vi.waitFor(() => expect(rows(id)).toHaveLength(1));
  expect(db.get("SELECT state,actualMicros FROM budgetReservations WHERE requestId=?", [id])).toMatchObject({ state:"settled", actualMicros:7 });
  expect(rows(id)[0].cost).toBe(7e-6);
});

it("correlates a rejected request without trusting the supplied ID", async () => {
  const response = await post(request(false,{authorization:"Bearer wrong", "X-Request-Id":"client.invalid"}));
  expect(response.status).toBe(401);
  const id=response.headers.get("x-request-id");
  expect(id).toBeTruthy(); expect(id).not.toBe("client.invalid");
  expect(rows(id)[0].status).toBe("error");
});

it.each([
  [{ error: "invalid_grant" }, "auth_invalid", "needs_reauth"],
  [new Error("refresh_token_reused"), "auth_invalid", "needs_reauth"],
  [new TypeError("fetch failed"), "network", "degraded"],
  [new Error("ETIMEDOUT"), "timeout", "degraded"],
  [{ status: 503 }, "upstream_error", "degraded"],
  [new Error("unexpected failure"), "auth_expired", "degraded"],
  [null, "auth_expired", "degraded"],
])("records OAuth refresh outcome %j as %s with state %s", async (outcome, category, state) => {
  const oauth = await repo.createProviderConnection({ provider, authType: "oauth", name: "fixture OAuth",
    accessToken: "fixture-access", refreshToken: "fixture-refresh", providerSpecificData: { apiType: "chat", baseUrl: "https://fixture.invalid" } });
  await repo.updateProviderConnection(first.id, { isActive: false });
  await repo.updateProviderConnection(second.id, { isActive: false });
  fake.refresh.mockReset();
  if (outcome instanceof Error) fake.refresh.mockRejectedValue(outcome);
  else fake.refresh.mockResolvedValue(outcome);
  fake.execute.mockResolvedValue({ response: Response.json({ error: "unauthorized" }, { status: 401 }), headers: {}, url: "fixture" });
  const response = await post(request(false));
  expect(response.ok).toBe(false);
  expect(fake.refresh).toHaveBeenCalled();
  expect(JSON.parse(rows(response.headers.get("x-request-id"))[0].meta).errorCategory).toBe(category);
  const { providerHealth } = await import("@/lib/observability/providerHealth.js");
  expect((await providerHealth()).find(c => c.id === oauth.id)).toMatchObject({ state, lastErrorCategory: category, isActive: true, quota: { known: false } });
  await repo.updateProviderConnection(oauth.id, { isActive: false });
});
