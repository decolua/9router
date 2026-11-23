import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseModelReference, formatModelReference } from "../../open-sse/utils/modelReference.js";
import { resolveCaps } from "../../src/shared/hooks/useModelCaps.js";

const fx = vi.hoisted(() => ({
  ids: ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"],
  connections: [], attempts: [], failA: false, status: 429, mode: "strict", keys: {},
  models: [], providerStrategy: "fill-first", empty: false, delay: false,
  normalEmpty: false, responseError: false, invalidJson: false, emptyResponses: false,
}));
vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: false, fallbackStrategy: fx.providerStrategy, stickyRoundRobinLimit: 1,
    comboStrategies: { ReviewPool: { fallbackStrategy: "round-robin", stickySession: true, accountFallbackMode: fx.mode } } }),
  getModelAliases: async () => ({ "pinned-alias": `openai/gpt-4o@${fx.ids[0]}` }),
  getComboByName: async name => name === "ReviewPool" ? { name, models: fx.models } : null,
  getProviderNodes: async () => [], getCombos: async () => [], getCustomModels: async () => [], getProxyPools: async () => [],
  getProviderConnections: async filter => fx.connections.filter(c => (!filter?.provider || c.provider === filter.provider) && (filter?.isActive === undefined || c.isActive === filter.isActive)),
  getProviderConnectionById: async id => fx.connections.find(c => c.id === id),
  updateProviderConnection: async (id, patch) => Object.assign(fx.connections.find(c => c.id === id), patch),
  validateApiKey: async () => true,
}));
vi.mock("@/lib/db/repos/combosRepo.js", () => ({ getCombos: async () => [{ name: "ReviewPool", models: fx.models }] }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({ getApiKeyByKey: async key => fx.keys[key] || null }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: async () => ({}), pickProxyPoolId: () => null }));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: async (_p, c) => c, updateProviderCredentials: vi.fn() }));
vi.mock("open-sse/services/projectId.js", () => ({ getProjectIdForConnection: async () => null }));
vi.mock("@/lib/usageDb.js", () => ({ saveRequestUsage: vi.fn() }));

async function execute({ connectionId, credentials }) {
  const id = connectionId || credentials?.connectionId;
  fx.attempts.push(id);
  if (fx.delay) await new Promise(resolve => setTimeout(resolve, 5));
  if (fx.failA && id === fx.ids[0]) return { success: false, status: fx.status, error: "Rate limited", response: Response.json({ error: { message: "Rate limited" } }, { status: fx.status }) };
  if (fx.invalidJson) return { success: true, response: new Response("{invalid", { headers: { "Content-Type": "application/json" } }) };
  if (fx.emptyResponses) return { success: true, response: Response.json({ status: "completed", output: [] }) };
  return { success: true, response: Response.json(fx.responseError ? { error: { message: "Failed generation" } } : { choices: [{ message: { content: fx.empty || fx.normalEmpty ? "" : id }, ...(fx.normalEmpty ? { finish_reason: "stop" } : {}) }] }) };
}
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: args => execute(args) }));
vi.mock("open-sse/handlers/imageGenerationCore.js", () => ({ handleImageGenerationCore: args => execute(args) }));
vi.mock("open-sse/handlers/embeddingsCore.js", () => ({ handleEmbeddingsCore: args => execute(args) }));
vi.mock("open-sse/handlers/ttsCore.js", () => ({ handleTtsCore: args => execute(args) }));
vi.mock("open-sse/handlers/sttCore.js", () => ({ handleSttCore: args => execute(args) }));
vi.mock("open-sse/handlers/videoCore.js", () => ({
  handleVideoProxyCore: args => execute(args), getVideoConfig: provider => provider === "xai" ? {} : null,
  sanitizeSecrets: value => value,
}));

const { handleChat } = await import("../../src/sse/handlers/chat.js");
const { handleImageGeneration } = await import("../../src/sse/handlers/imageGeneration.js");
const { handleEmbeddings } = await import("../../src/sse/handlers/embeddings.js");
const { handleTts } = await import("../../src/sse/handlers/tts.js");
const { handleStt } = await import("../../src/sse/handlers/stt.js");
const { handleVideoCreate, handleVideoGet } = await import("../../src/sse/handlers/videoGeneration.js");
const { enforceKeyAccess, filterModelsListForKey } = await import("../../src/sse/services/keyAccess.js");
const { resetComboRotation } = await import("../../open-sse/services/combo.js");
const { resetStickyComboStore } = await import("../../open-sse/services/comboSession.js");
const { getModelInfo } = await import("../../src/sse/services/model.js");
const { accountSelectionOptions } = await import("../../src/sse/services/accountSelection.js");
const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

beforeEach(() => {
  resetStickyComboStore(); resetComboRotation();
  Object.assign(fx, { attempts: [], failA: false, status: 429, mode: "strict", keys: {}, empty: false, delay: false, providerStrategy: "fill-first", normalEmpty: false, responseError: false, invalidJson: false, emptyResponses: false });
  fx.connections = fx.ids.map(id => ({ id, provider: "openai", isActive: true, name: id, apiKey: "test-only", authType: "apikey", providerSpecificData: {} }));
  fx.models = fx.ids.map(id => `openai/gpt-4o@${id}`);
});
const post = (model, extra = {}, headers = {}) => new Request("http://localhost/v1/chat/completions", {
  method: "POST", headers: { "Content-Type": "application/json", "x-session-id": "shared-session", ...headers },
  body: JSON.stringify({ model, messages: [{ role: "user", content: "Check routing" }], ...extra }),
});
const chat = headers => handleChat(post("ReviewPool", {}, headers));
const content = async response => (await response.json()).choices[0].message.content;
function recoverA() { fx.failA = false; for (const key of Object.keys(fx.connections[0])) if (key.startsWith("modelLock_")) delete fx.connections[0][key]; }

describe("Account references and permissions", () => {
  it.each(["cf/@cf/meta/llama-3-8b-instruct", "vertex/claude-sonnet@20250929", "custom/model@release"])('preserves native @ in %s', value => {
    expect(parseModelReference(value)).toEqual({ model: value, connectionId: null });
  });
  it("round-trips Cloudflare with a UUID account and uses its original capability map", () => {
    const base = "cf/@cf/meta/llama-3-8b-instruct";
    expect(parseModelReference(formatModelReference(base, fx.ids[0]))).toEqual({ model: base, connectionId: fx.ids[0] });
    const caps = { contextWindow: 8192, maxOutput: 4096 };
    expect(resolveCaps({ [base]: caps }, {}, base)).toBe(caps);
    expect(resolveCaps({ [base]: caps }, {}, formatModelReference(base, fx.ids[0]))).toBe(caps);
  });
  it("resolves account affinity inside an alias", async () => {
    expect(await getModelInfo("pinned-alias")).toEqual({ provider: "openai", model: "gpt-4o", connectionId: fx.ids[0] });
  });
  it("a pinned rule denies other accounts and bare requests, and exposes a callable catalog entry", async () => {
    const ctx = { keyName: "A only", allow: [`openai/gpt-4o@${fx.ids[0]}`] };
    expect(await enforceKeyAccess(ctx, `openai/gpt-4o@${fx.ids[0]}`)).toBeNull();
    expect((await enforceKeyAccess(ctx, `openai/gpt-4o@${fx.ids[1]}`)).status).toBe(403);
    expect((await enforceKeyAccess(ctx, "openai/gpt-4o")).status).toBe(403);
    expect(await filterModelsListForKey(ctx, [{ id: "openai/gpt-4o" }])).toEqual([{ id: `openai/gpt-4o@${fx.ids[0]}` }]);
  });
  it("keeps context markers separate from the selected account", async () => {
    fx.connections.forEach(c => { c.provider = "codex"; c.providerSpecificData.enabledModels = ["gpt-6[1m]"]; });
    expect(await content(await handleChat(post(`codex/gpt-6@${fx.ids[0]}[1m]`)))).toBe(fx.ids[0]);
  });
  it("checks account headers before looking up credentials", async () => {
    fx.keys.limited = { id: "limited", access: { restricted: true, allow: [`openai/gpt-4o@${fx.ids[0]}`] } };
    expect((await handleChat(post("openai/gpt-4o", {}, { Authorization: "Bearer limited", "x-connection-id": fx.ids[1] }))).status).toBe(403);
    expect(fx.attempts).toEqual([]);
    expect(await content(await handleChat(post("openai/gpt-4o", {}, { Authorization: "Bearer limited", "x-connection-id": fx.ids[0] })))).toBe(fx.ids[0]);
  });
  it("prefer never expands an account-scoped key on a retry", async () => {
    const selection = await accountSelectionOptions({ provider: "openai", model: "gpt-4o", connectionId: fx.ids[0] }, null, {
      accountFallbackMode: "prefer", keyAccess: { allow: [`openai/gpt-4o@${fx.ids[0]}`] },
    });
    expect((await getProviderCredentials("openai", new Set(), "gpt-4o", selection)).connectionId).toBe(fx.ids[0]);
    expect(await getProviderCredentials("openai", new Set([fx.ids[0]]), "gpt-4o", selection)).toBeNull();
  });
});

describe("Successful account affinity", () => {
  it.each(["strict", "prefer"])("%s re-anchors A to B, including after A recovers", async mode => {
    fx.mode = mode;
    expect(await content(await chat())).toBe(fx.ids[0]);
    fx.failA = true;
    expect(await content(await chat())).toBe(fx.ids[1]);
    recoverA();
    expect(await content(await chat())).toBe(fx.ids[1]);
  });
  it("strict skips the failed member instead of a hidden account switch", async () => {
    fx.models = [`openai/gpt-4o@${fx.ids[0]}`]; fx.failA = true;
    expect((await chat()).status).toBe(503);
    expect(fx.attempts).toEqual([fx.ids[0]]);
  });
  it("Auto retains the actual account despite provider round-robin", async () => {
    fx.models = ["openai/gpt-4o"]; fx.providerStrategy = "round-robin";
    expect(await content(await chat())).toBe(fx.ids[0]);
    expect(await content(await chat())).toBe(fx.ids[0]);
  });
  it("isolates identical session IDs across client keys", async () => {
    fx.models = ["openai/gpt-4o"]; fx.providerStrategy = "round-robin";
    expect(await content(await chat({ Authorization: "Bearer client-a" }))).toBe(fx.ids[0]);
    expect(await content(await chat({ Authorization: "Bearer client-b" }))).toBe(fx.ids[1]);
    expect(await content(await chat({ Authorization: "Bearer client-a" }))).toBe(fx.ids[0]);
  });
  it("concurrent first turns of the same session agree on one account", async () => {
    fx.models = ["openai/gpt-4o"]; fx.providerStrategy = "round-robin"; fx.delay = true;
    expect(await Promise.all([chat().then(content), chat().then(content)])).toEqual([fx.ids[0], fx.ids[0]]);
  });
  it("invalidates the stored route when combo policy changes", async () => {
    fx.models = [`openai/gpt-4o@${fx.ids[0]}`]; fx.mode = "prefer"; fx.failA = true;
    expect(await content(await chat())).toBe(fx.ids[1]);
    recoverA(); fx.mode = "strict";
    expect(await content(await chat())).toBe(fx.ids[0]);
  });
});

it("an account-scoped direct key cannot fail over to an unauthorized account", async () => {
  fx.keys.limited = { id: "limited", access: { restricted: true, allow: [`openai/gpt-4o@${fx.ids[0]}`] } };
  fx.failA = true;
  expect((await handleChat(post(`openai/gpt-4o@${fx.ids[0]}`, {}, { Authorization: "Bearer limited" }))).status).toBe(503);
  expect(fx.attempts).toEqual([fx.ids[0]]);
});

it("empty responses never create a sticky account", async () => {
  fx.models = ["openai/gpt-4o"]; fx.providerStrategy = "round-robin"; fx.empty = true;
  await chat(); await chat();
  expect(fx.attempts).toEqual([fx.ids[0], fx.ids[1]]);
});

it.each(["normalEmpty", "responseError", "invalidJson", "emptyResponses"])("%s does not create successful affinity or change retry rules", async reply => {
  fx.models = ["openai/gpt-4o"]; fx.providerStrategy = "round-robin"; fx[reply] = true;
  await chat(); await chat();
  expect(fx.attempts).toEqual([fx.ids[0], fx.ids[1]]);
});

describe("Shared account selection in media handlers", () => {
  it.each(["strict", "prefer"])("%s does not silently ignore an account for a provider without accounts", async mode => {
    fx.mode = mode; fx.models = [`sdwebui/default@${fx.ids[0]}`];
    expect((await handleImageGeneration(post("ReviewPool", { prompt: "test" }))).status).toBe(400);
    expect(fx.attempts).toEqual([]);
  });
  it.each([
    ["images", "openai/gpt-image-1", (model, headers) => handleImageGeneration(post(model, { prompt: "test" }, headers))],
    ["embeddings", "openai/text-embedding-3-small", (model, headers) => handleEmbeddings(post(model, { input: "test" }, headers))],
    ["speech", "openai/tts-1", (model, headers) => handleTts(post(model, { input: "test" }, headers))],
    ["transcription", "openai/whisper-1", (model, headers) => {
      const form = new FormData(); form.set("model", model); form.set("file", new Blob(["test"]), "a.wav");
      return handleStt(new Request("http://localhost/v1/audio/transcriptions", { method: "POST", headers, body: form }));
    }],
  ])("%s respects UUID suffixes and legacy IDs in headers", async (_name, model, run) => {
    expect((await run(`${model}@${fx.ids[1]}`, {})).status).toBe(200);
    expect(fx.attempts).toEqual([fx.ids[1]]);
    fx.connections[1].id = "legacy-account"; fx.attempts = [];
    expect((await run(model, { "x-connection-id": "legacy-account" })).status).toBe(200);
    expect(fx.attempts).toEqual(["legacy-account"]);
  });
  it("video creation and polling stay on the selected account", async () => {
    fx.connections.forEach(c => c.provider = "xai");
    const response = await handleVideoCreate(post(`xai/grok-imagine-video@${fx.ids[1]}`), "generations");
    expect(response.status).toBe(200);
    expect(response.headers.get("x-9router-connection-id")).toBe(fx.ids[1]);
    expect((await handleVideoGet(new Request("http://localhost/v1/videos/job", { headers: { "x-connection-id": fx.ids[1] } }), "job")).status).toBe(200);
    expect(fx.attempts).toEqual([fx.ids[1], fx.ids[1]]);
  });
  it("does not repeat potentially billed video creation after a 5xx", async () => {
    fx.connections.forEach(c => c.provider = "xai"); fx.failA = true; fx.status = 503;
    expect((await handleVideoCreate(post("xai/grok-imagine-video"), "generations")).status).toBe(503);
    expect(fx.attempts).toEqual([fx.ids[0]]);
  });
});
