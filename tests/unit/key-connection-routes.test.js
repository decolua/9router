import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const selections = vi.hoisted(() => []);
// Exercise the production selector and stop immediately before outbound I/O.
vi.mock("@/sse/services/auth.js", async original => {
  const auth = await original();
  return {
    ...auth,
    async getProviderCredentials(provider, excluded, model, options) {
      const result = await auth.getProviderCredentials(provider, excluded, model, options);
      selections.push({ provider, model, id: result?.connectionId });
      result?.releaseSelection?.();
      return result?.connectionId ? null : result;
    },
  };
});

const routes = import.meta.glob("../../src/app/api/**/route.js");
const messages = [{ role: "user", content: "hello" }];
const dir = mkdtempSync(join(tmpdir(), "key-pin-routes-"));
const accounts = new Map();
let repo, db, key, budgetKey;

beforeAll(async () => {
  vi.stubEnv("DATA_DIR", dir);
  repo = await import("@/lib/db/index.js");
  db = await (await import("@/lib/db/driver.js")).getAdapter();
  for (const provider of ["openai", "xai", "tavily", "gemini", "ollama", "ollama-search"]) {
    const add = name => repo.createProviderConnection({ provider, authType: "apikey", name });
    accounts.set(provider, { first: await add("first"), second: await add("second") });
  }
  const allowedConnections = [...accounts.values()].map(pair => pair.second.id);
  key = await repo.createApiKey("ordinary", "test", { allowedConnections });
  budgetKey = await repo.createApiKey("metered", "test", {
    allowedConnections,
    budget: {
      provider: "openai", model: "gpt-4o", inputTokenCeiling: 10, tokenLimit: 100,
      costLimitMicros: 100, inputRate: 1, outputRate: 1, tariffDate: "2026-11-23",
    },
  });
  await repo.createCombo({ name: "smart-fixture", models: ["openai/gpt-4o", "xai/other"] });
  await repo.updateSettings({
    comboStrategies: { "smart-fixture": { fallbackStrategy: "smart", routerModel: "gemini/router" } },
  });
}, 30000);

beforeEach(() => { selections.length = 0; });
afterAll(() => {
  db?.close();
  delete global._dbAdapter;
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

async function dispatch(path, body, { route = path, params = {}, apiKey = key, headers = {} } = {}) {
  const entry = await routes["../../src/app/api/" + route + "/route.js"]();
  const method = body ? "POST" : "GET";
  const form = body instanceof FormData;
  const request = new Request("http://localhost/" + path, {
    method,
    headers: {
      authorization: "Bearer " + apiKey.key,
      ...(!form && { "content-type": "application/json" }),
      ...headers,
    },
    body: form ? body : body ? JSON.stringify(body) : undefined,
  });
  return entry[method](request, { params: Promise.resolve(params) });
}

it.each([
  ["v1/chat/completions", "openai", { model: "openai/gpt-4o", messages }],
  ["v1/embeddings", "openai", { model: "openai/text-embedding-3-small", input: "hello" }],
  ["v1/images/generations", "openai", { model: "openai/dall-e-3", prompt: "hello" }],
  ["v1/audio/speech", "openai", { model: "openai/tts-1", input: "hello" }],
  ["v1/videos/generations", "xai", { model: "xai/grok-imagine-video", prompt: "hello" }],
  ["v1/search", "tavily", { model: "tavily", query: "hello" }],
  ["v1/web/fetch", "tavily", { model: "tavily", url: "https://example.org/" }],
  ["v1/systemone", "openai", { model: "openai/gpt-4o", state: {}, questions: { q: "?" } }],
])("%s selects the verified key's second account despite a conflicting preference", async (path, provider, body) => {
  const { first, second } = accounts.get(provider);
  await dispatch(path, body, { headers: { "x-connection-id": first.id } });
  expect(selections.map(s => s.id)).toEqual([second.id]);
});

it("scopes transcription and account-bound video polling", async () => {
  const form = new FormData();
  form.set("model", "openai/whisper-1");
  form.set("file", new Blob(["hello"], { type: "audio/wav" }), "audio.wav");
  await dispatch("v1/audio/transcriptions", form);
  await dispatch("v1/videos/job", null, {
    route: "v1/videos/[id]", params: { id: "job" },
    headers: { "x-connection-id": accounts.get("xai").first.id },
  });
  expect(selections.map(s => s.id)).toEqual([accounts.get("openai").second.id, accounts.get("xai").second.id]);
});

it.each(["v1/messages", "v1/responses", "v1/chat/completions"])("scopes budgetInference on %s", async path => {
  const body = path.endsWith("/responses") ? { input: "hello", max_output_tokens: 2 } : { messages, max_tokens: 2 };
  const response = await dispatch(path, { ...body, model: "openai/gpt-4o" }, { apiKey: budgetKey });
  expect(response.status).toBe(503);
  expect(selections.map(s => s.id)).toEqual([accounts.get("openai").second.id]);
});

it("scopes native Gemini with Google's key header", async () => {
  const model = "gemini-2.5-flash-preview-tts:generateContent";
  await dispatch("v1beta/models/" + model, {
    contents: [{ parts: [{ text: "hello" }] }], generationConfig: { responseModalities: ["AUDIO"] },
  }, {
    route: "v1beta/models/[...path]", params: { path: [model] },
    headers: { authorization: "", "x-goog-api-key": key.key },
  });
  expect(selections.map(s => s.id)).toEqual([accounts.get("gemini").second.id]);
});

it("scopes the smart classifier and each provider reached by combo fallback", async () => {
  await dispatch("v1/chat/completions", { model: "smart-fixture", messages });
  expect(selections.map(s => s.id)).toEqual(["gemini", "openai", "xai"].map(p => accounts.get(p).second.id));
});

it("scopes borrowed search credentials and never borrows past an exhausted pinned search provider", async () => {
  const ollama = accounts.get("ollama");
  const search = accounts.get("ollama-search");
  const borrower = await repo.createApiKey("borrower", "test", { allowedConnections: [ollama.second.id] });
  await dispatch("v1/search", { model: "ollama-search", query: "hello" }, { apiKey: borrower });
  expect(selections.map(s => s.id)).toEqual([search.first.id, ollama.second.id]);
  selections.length = 0;
  await repo.updateProviderConnection(search.second.id, { isActive: false });
  const response = await dispatch("v1/search", { model: "ollama-search", query: "hello" });
  expect(response.status).toBe(503);
  expect(selections).toHaveLength(1);
  expect(selections[0].id).toBeUndefined();
});
