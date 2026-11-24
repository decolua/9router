import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { fetchUpstream } = vi.hoisted(() => ({ fetchUpstream: vi.fn() }));
vi.mock("open-sse/utils/proxyFetch.js", async original => ({
  ...await original(), proxyAwareFetch: fetchUpstream,
}));

const dir = mkdtempSync(join(tmpdir(), "inference-json-usage-"));
const provider = "openai-compatible-chat-fixture";
const baseUrl = "https://fixture.invalid/v1";
const chat = "/v1/chat/completions";
const messages = [{ role: "user", content: "hi" }];
const usage = { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 };
const completion = { id: "x", object: "chat.completion", model: "m1",
  choices: [{ index: 0, message: { role: "assistant", content: "from-B" }, finish_reason: "stop" }] };
let db, repo, routes, key, second;

beforeAll(async () => {
  vi.stubEnv("DATA_DIR", dir);
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  repo = await import("@/lib/db/index.js");
  await repo.updateSettings({ requireApiKey: true });
  key = await repo.createApiKey("usage fixture", "machine");
  await repo.createProviderNode({ id: provider, type: "openai-compatible", name: "fixture", prefix: "fixture", apiType: "chat", baseUrl });
  const connect = (id, name, apiType) => repo.createProviderConnection({
    provider: id, name, authType: "apikey", apiKey: "fixture-" + name, providerSpecificData: { baseUrl, apiType },
  });
  await connect(provider, "first", "chat");
  second = await connect(provider, "second", "chat");
  const claude = "anthropic-compatible-fixture";
  const responses = "openai-compatible-responses-fixture";
  await connect(claude, "claude");
  await connect(responses, "responses", "responses");
  await connect("gemini", "gemini");
  for (const id of [provider, claude, responses, "gemini"]) {
    await repo.updatePricing({ [id]: { m1: { input: 1, output: 2 } } });
  }
  routes = {
    [chat]: (await import("@/app/api/v1/chat/completions/route.js")).POST,
    "/v1/messages": (await import("@/app/api/v1/messages/route.js")).POST,
    "/v1/responses": (await import("@/app/api/v1/responses/route.js")).POST,
  };
}, 30000);

beforeEach(() => {
  fetchUpstream.mockReset();
  db.exec("DELETE FROM usageHistory; DELETE FROM usageDaily; DELETE FROM _meta WHERE key='totalRequestsLifetime'");
});
afterAll(() => {
  db?.close();
  delete global._dbAdapter;
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function post(body, endpoint = chat, clientKey = key) {
  return routes[endpoint](new Request("http://localhost" + endpoint, { method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer " + clientKey.key },
    body: JSON.stringify({ model: "fixture/m1", messages, max_tokens: 5, ...body }),
  }));
}

async function expectAccounting(response, { input = 3, output = 2, reported = true, cost = 7e-6, clientKey = key, meta = {} } = {}) {
  expect(response.status).toBe(200);
  const id = response.headers.get("x-request-id");
  expect(id).toBeTruthy();
  await vi.waitFor(() => expect(db.all("SELECT id FROM usageHistory")).toHaveLength(1));
  const [row] = db.all("SELECT * FROM usageHistory");
  expect(row).toMatchObject({ requestId: id, promptTokens: input, completionTokens: output, status: "ok" });
  expect(row.cost).toBeCloseTo(cost, 12);
  if (reported) expect(JSON.parse(row.tokens)).toMatchObject({ prompt_tokens: input, completion_tokens: output });
  else expect(JSON.parse(row.tokens)).toEqual({});
  expect(JSON.parse(row.meta)).toMatchObject({ usageReported: reported, ...meta });
  const day = JSON.parse(db.get("SELECT data FROM usageDaily").data);
  const counts = { requests: 1, promptTokens: input, completionTokens: output };
  expect(day).toMatchObject(counts);
  expect(day.cost).toBeCloseTo(cost, 12);
  expect(db.get("SELECT value FROM _meta WHERE key='totalRequestsLifetime'").value).toBe("1");
  const { byApiKey } = await repo.getUsageStats("all");
  expect(Object.values(byApiKey)).toEqual([expect.objectContaining({ ...counts, keyId: clientKey.id })]);
  expect(Object.values(byApiKey)[0].cost).toBeCloseTo(cost, 12);
  return row;
}

it.each([undefined, false])("records the raw JSON completion once (stream=%s)", async stream => {
  fetchUpstream.mockResolvedValueOnce(Response.json({ ...completion, usage }));
  const response = await post({ stream });
  expect(fetchUpstream.mock.calls[0][0]).toBe(baseUrl + "/chat/completions");
  expect(response.headers.get("content-type")).toContain("application/json");
  expect((await response.json()).choices).toEqual(completion.choices);
  const row = await expectAccounting(response);
  expect(JSON.parse(row.tokens)).toMatchObject(usage);
});

it.each([false, true])("distinguishes missing usage from reported zero (reported=%s)", async reported => {
  const zero = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  fetchUpstream.mockResolvedValueOnce(Response.json(reported ? { ...completion, usage: zero } : completion));
  const response = await post({ stream: false });
  expect((await response.json()).choices).toEqual(completion.choices);
  await expectAccounting(response, { input: 0, output: 0, cost: 0, reported });
});

it("records native Claude messages with cache-inclusive input", async () => {
  const content = [{ type: "text", text: "from-B" }];
  fetchUpstream.mockResolvedValueOnce(Response.json({ type: "message", role: "assistant", content, stop_reason: "end_turn",
    usage: { input_tokens: 1, cache_read_input_tokens: 2, output_tokens: 2 } }));
  const response = await post({ model: "anthropic-compatible-fixture/m1", stream: false }, "/v1/messages");
  expect(await response.json()).toMatchObject({ type: "message", content });
  const row = await expectAccounting(response);
  expect(JSON.parse(row.tokens).cached_tokens).toBe(2);
});

it("records native Responses JSON", async () => {
  fetchUpstream.mockResolvedValueOnce(Response.json({ object: "response", output: [],
    usage: { input_tokens: 3, input_tokens_details: { cached_tokens: 1 }, output_tokens: 2 } }));
  const response = await post({ model: "openai-compatible-responses-fixture/m1", input: "hi", messages: undefined, stream: false }, "/v1/responses");
  expect(await response.json()).toHaveProperty("object", "response");
  const row = await expectAccounting(response);
  expect(JSON.parse(row.tokens).cached_tokens).toBe(1);
});

it("records Gemini usageMetadata before chat translation", async () => {
  fetchUpstream.mockResolvedValueOnce(Response.json({ candidates: [{ content: { parts: [{ text: "from-B" }] } }],
    usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 } }));
  const response = await post({ model: "gemini/m1", stream: false });
  expect((await response.json()).choices[0].message.content).toBe("from-B");
  await expectAccounting(response);
});

it("records one usage trailer for a streamed completion", async () => {
  const events = [
    { choices: [{ index: 0, delta: { content: "from-B" } }] },
    { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    { choices: [], usage },
  ];
  const sse = events.map(event => "data: " + JSON.stringify(event) + "\n\n").join("") + "data: [DONE]\n\n";
  fetchUpstream.mockResolvedValueOnce(new Response(sse, { headers: { "content-type": "text/event-stream" } }));
  const response = await post({ stream: true });
  expect(response.headers.get("content-type")).toContain("text/event-stream");
  expect(await response.text()).toContain("[DONE]");
  await expectAccounting(response);
});

it("records only the successful account after a 429 fallback", async () => {
  fetchUpstream.mockResolvedValueOnce(Response.json({ error: "quota exceeded" }, { status: 429 }))
    .mockResolvedValueOnce(Response.json({ ...completion, usage }));
  const response = await post({});
  expect(fetchUpstream).toHaveBeenCalledTimes(2);
  expect((await response.json()).choices).toEqual(completion.choices);
  await expectAccounting(response, { meta: { attempts: 2, fallbacks: 1, finalConnectionId: second.id } });
});

it("keeps budget settlement as the only accounting writer", async () => {
  const clientKey = await repo.createApiKey("budget fixture", "machine", { budget: { provider, model: "m1",
    inputTokenCeiling: 10, tokenLimit: 100, costLimitMicros: 100, inputRate: 2000000, outputRate: 3000000, tariffDate: "2026-11-23" } });
  fetchUpstream.mockResolvedValueOnce(Response.json({ ...completion, usage }));
  const response = await post({ stream: false }, chat, clientKey);
  expect((await response.json()).choices).toEqual(completion.choices);
  const row = await expectAccounting(response, { clientKey, cost: 12e-6 });
  expect(db.all("SELECT requestId,state,actualMicros FROM budgetReservations")).toEqual([
    { requestId: row.requestId, state: "settled", actualMicros: 12 },
  ]);
});
