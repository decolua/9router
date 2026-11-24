import { beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ settings: {}, keys: {}, combos: [] }));
const mocks = vi.hoisted(() => ({
  core: vi.fn(), credentials: vi.fn(), unavailable: vi.fn(), transform: vi.fn(),
  lookup: vi.fn(async (key) => fx.keys[key] || null),
}));
vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => fx.settings,
  getModelAliases: async () => ({}),
  getComboByName: async (name) => fx.combos.find((c) => c.name === name) || null,
  getProviderNodes: async () => [], getCombos: async () => fx.combos,
  getProviderConnections: async () => [], getProviderConnectionById: async () => null,
  getCustomModels: async () => [],
}));
vi.mock("@/lib/db/index.js", () => ({ getApiKeyByKey: mocks.lookup }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({ getApiKeyByKey: mocks.lookup }));
vi.mock("@/lib/db/repos/combosRepo.js", () => ({ getCombos: async () => fx.combos }));
vi.mock("@/lib/disabledModelsDb", () => ({ getDisabledModels: async () => ({}) }));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.credentials,
  markAccountUnavailable: mocks.unavailable, clearAccountError: vi.fn(),
  extractApiKey: (req) => {
    const a = req.headers.get("Authorization");
    return a?.startsWith("Bearer ") ? a.slice(7) : req.headers.get("x-api-key");
  },
  isValidApiKey: async (key) => fx.keys[key]?.isActive === true,
}));
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: async (_p, c) => c, updateProviderCredentials: vi.fn(),
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.core }));
vi.mock("@/lib/pxpipe/loader.js", () => ({ getTransform: mocks.transform }));
vi.mock("@/lib/pxpipe/events.js", () => ({ appendPxpipeEvent: vi.fn() }));

const { handleChat } = await import("@/sse/handlers/chat.js");
const flags = { rtkEnabled: false, headroomEnabled: true, cavemanEnabled: false, ponytailEnabled: true };
const opposite = Object.fromEntries(Object.entries(flags).map(([k, v]) => [k, !v]));
const policy = { overrideEnabled: true, enabled: true, ...flags };
const ok = () => ({ success: true, response: Response.json({ choices: [{ message: { role: "assistant", content: "answer" } }] }) });
const fail = () => ({ success: false, status: 500, error: "upstream error", response: Response.json({ error: "upstream error" }, { status: 500 }) });
const chat = (model = "openai/model-b", key = "sk-one", headers = {}, extra = {}, query = "") => handleChat(new Request(`http://localhost/v1/chat/completions${query}`, {
  method: "POST", headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}), ...headers },
  body: JSON.stringify({ model, stream: false, messages: [{ role: "user", content: "hi" }], ...extra }),
}));
const calls = () => mocks.core.mock.calls.map(([options]) => options);
const expectFlags = (options, expected = flags) => expect(options).toMatchObject(expected);

beforeEach(() => {
  vi.clearAllMocks();
  fx.settings = {
    requireApiKey: false, comboStrategy: "fallback", ...opposite,
    headroomUrl: "http://localhost:8787", headroomTimeoutMs: 4567, headroomCompressUserMessages: true,
    cavemanLevel: "ultra", ponytailLevel: "lite", customPromptEnabled: true, customPrompt: "test prompt", pxpipeEnabled: false,
  };
  fx.keys = {
    "sk-one": { id: "one", isActive: true, access: { restricted: false, allow: [] }, tokenSaver: { ...policy } },
    "sk-two": { id: "two", isActive: true, access: { restricted: false, allow: [] }, tokenSaver: { ...policy, ...opposite } },
  };
  fx.combos = [{ name: "Main", models: ["openai/model-a", "openai/model-b"] }];
  mocks.lookup.mockImplementation(async (key) => fx.keys[key] || null);
  mocks.credentials.mockImplementation(async (_p, excluded) => excluded.size ? null : { connectionId: "c1" });
  mocks.unavailable.mockResolvedValue({ shouldFallback: false });
  mocks.core.mockImplementation(async () => ok());
  mocks.transform.mockResolvedValue(null);
});

describe("per-key token saver chat dispatch", () => {
  it("applies unrestricted key preferences while retaining all shared parameters", async () => {
    expect((await chat()).status).toBe(200);
    expectFlags(calls()[0]);
    expect(calls()[0]).toMatchObject({ headroomUrl: fx.settings.headroomUrl, headroomTimeoutMs: 4567, headroomCompressUserMessages: true, cavemanLevel: "ultra", ponytailLevel: "lite", customPromptEnabled: true, customPrompt: "test prompt", pxpipeEnabled: false });
    expect(mocks.transform).not.toHaveBeenCalled();
  });

  it("inherits for missing/unknown/inactive keys and inactive overrides", async () => {
    fx.keys["sk-paused"] = { ...fx.keys["sk-one"], isActive: false };
    fx.keys["sk-inherit"] = { ...fx.keys["sk-one"], tokenSaver: { ...policy, overrideEnabled: false } };
    fx.keys["sk-legacy"] = { ...fx.keys["sk-one"], tokenSaver: null };
    for (const key of [null, "sk-unknown", "sk-paused", "sk-inherit", "sk-legacy"]) {
      expect((await chat("openai/model-b", key)).status).toBe(200);
      expectFlags(calls().at(-1), opposite);
    }
  });

  it("master OFF disables only four modules and does not suppress global PXPIPE loading", async () => {
    fx.keys["sk-one"].tokenSaver.enabled = false;
    fx.settings.pxpipeEnabled = true;
    await chat();
    expectFlags(calls()[0], Object.fromEntries(Object.keys(flags).map((k) => [k, false])));
    expect(calls()[0]).toMatchObject({ customPromptEnabled: true, pxpipeEnabled: true });
    expect(mocks.transform).toHaveBeenCalledOnce();
  });

  it.each([
    [{ "x-api-key": "sk-one" }, ""],
    [{ "x-goog-api-key": "sk-one" }, ""],
    [{}, "?key=sk-one"],
  ])("uses existing metadata extraction for %j %s", async (headers, query) => {
    expect((await chat("openai/model-b", null, headers, {}, query)).status).toBe(200);
    expectFlags(calls()[0]);
  });

  it("preserves credential precedence without falling through an invalid selection", async () => {
    await chat("openai/model-b", "unknown", { "x-api-key": "sk-one", "x-goog-api-key": "sk-two" }, {}, "?key=sk-one");
    expectFlags(calls()[0], opposite);
    await chat("openai/model-b", null, { "x-api-key": "sk-one", "x-goog-api-key": "sk-two" }, {}, "?key=sk-two");
    expectFlags(calls()[1]);
    await chat("openai/model-b", null, { "x-goog-api-key": "sk-one" }, {}, "?key=sk-two");
    expectFlags(calls()[2]);
  });

  it("does not widen existing authentication or bypass restricted model access", async () => {
    fx.settings.requireApiKey = true;
    for (const [key, headers, query] of [[null, {}, ""], ["unknown", {}, ""], [null, { "x-goog-api-key": "sk-one" }, ""], [null, {}, "?key=sk-one"]]) {
      expect((await chat("openai/model-b", key, headers, {}, query)).status).toBe(401);
    }
    expect(mocks.core).not.toHaveBeenCalled();
    expect((await chat()).status).toBe(200);
    expectFlags(calls()[0]);
    fx.keys["sk-one"].access = { restricted: true, allow: ["Main"] };
    expect((await chat()).status).toBe(403);
    expect((await chat("Main")).status).toBe(200);
    calls().forEach((c) => expectFlags(c));
  });

  it.each([false, true])("retains a snapshot through fallback (nested=%s)", async (nested) => {
    fx.settings = { ...fx.settings, ...flags };
    if (nested) fx.combos.push({ name: "Outer", models: ["Main"] });
    mocks.core.mockImplementation(async ({ modelInfo }) => {
      if (modelInfo.model === "model-a") {
        fx.keys["sk-one"].tokenSaver = { ...policy, enabled: false };
        fx.settings = { ...fx.settings, ...opposite };
        return fail();
      }
      return ok();
    });
    expect((await chat(nested ? "Outer" : "Main")).status).toBe(200);
    expect(calls().map((c) => c.modelInfo.model)).toEqual(["model-a", "model-b"]);
    calls().forEach((c) => expectFlags(c));
  });

  it.each([false, true])("passes flags to fusion panels and judge (nested=%s)", async (nested) => {
    fx.settings.comboStrategies = { Main: { fallbackStrategy: "fusion", judgeModel: "openai/judge" } };
    if (nested) fx.combos.push({ name: "Outer", models: ["Main"] });
    expect((await chat(nested ? "Outer" : "Main")).status).toBe(200);
    expect(calls().map((c) => c.modelInfo.model).sort()).toEqual(["judge", "model-a", "model-b"]);
    calls().forEach((c) => expectFlags(c));
  });

  it("retains flags across provider account retries", async () => {
    mocks.credentials.mockImplementation(async (_p, excluded) => ({ connectionId: excluded.has("c1") ? "c2" : "c1" }));
    mocks.unavailable.mockResolvedValue({ shouldFallback: true });
    mocks.core.mockImplementation(async ({ connectionId }) => connectionId === "c1" ? fail() : ok());
    expect((await chat()).status).toBe(200);
    expect(calls().map((c) => c.connectionId)).toEqual(["c1", "c2"]);
    calls().forEach((c) => expectFlags(c));
  });

  it("preserves context markers while passing policy to the core", async () => {
    expect((await chat("openai/model-b[1m]")).status).toBe(200);
    expect(mocks.credentials).toHaveBeenCalledWith("openai", expect.any(Set), "model-b", { requestedModel: "model-b[1m]" });
    expectFlags(calls()[0]);
  });

  it("passes flags through capability adapter fallback", async () => {
    fx.settings.capacityAdapter = { vision: { enabled: true, models: ["cmc/moonshotai/Kimi-K3"] } };
    mocks.core.mockImplementation(async ({ modelInfo }) => modelInfo.model.includes("Kimi") ? fail() : ok());
    const res = await chat("cmc/deepseek/deepseek-v4-pro", "sk-one", {}, { messages: [{ role: "user", content: "Analyze", images: ["base64data"] }] });
    expect(res.status).toBe(200);
    expect(calls()).toHaveLength(2);
    calls().forEach((c) => expectFlags(c));
  });

  it("isolates simultaneous keys and ignores client-supplied policy fields", async () => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    mocks.core.mockImplementation(async () => { if (mocks.core.mock.calls.length === 2) release(); await gate; return ok(); });
    const results = await Promise.all([chat(undefined, "sk-one", {}, { tokenSaver: { enabled: false }, ...opposite }), chat(undefined, "sk-two")]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expectFlags(calls().find((c) => c.apiKey === "sk-one"));
    expectFlags(calls().find((c) => c.apiKey === "sk-two"), opposite);
  });
});
