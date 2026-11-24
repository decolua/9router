// Per-API-key access control: engine + helpers.
// Real model resolution (src/sse/services/model.js) over a mocked DB fixture, so
// alias / provider-alias / node-prefix resolution is exercised for real.
import { describe, it, expect, vi, beforeEach } from "vitest";

const fx = vi.hoisted(() => ({
  combos: [
    { id: "c1", name: "Main", models: ["openai/model-a", "openai/model-b"] },
    { id: "c2", name: "other", models: ["openai/model-c"] },
    { id: "c3", name: "mixed", models: ["openai/model-a", "anthropic/claude-3-5"] },
  ],
  nodes: [{ id: "openai-compatible-chat-n1", type: "openai-compatible", prefix: "mock" }],
  aliases: { fast: "openai/model-a", bee: "openai/model-b" },
  keys: {},
  connections: [
    { id: "conn-oa-1", provider: "openai", name: "OpenAI Account 1" },
    { id: "conn-oa-2", provider: "openai", name: "OpenAI Account 2" },
    { id: "conn-ant-1", provider: "anthropic", name: "Anthropic Account 1" },
  ],
}));

vi.mock("@/lib/localDb", () => ({
  getModelAliases: async () => fx.aliases,
  getComboByName: async (name) => fx.combos.find((c) => c.name === name) || null,
  getProviderNodes: async (filter = {}) => fx.nodes.filter((n) => !filter.type || n.type === filter.type),
}));
vi.mock("@/lib/db/repos/combosRepo.js", () => ({ getCombos: async () => fx.combos }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({ getApiKeyByKey: async (k) => fx.keys[k] || null }));
vi.mock("@/lib/db/repos/connectionsRepo.js", () => ({
  getProviderConnectionsByIds: async (ids) => fx.connections.filter((c) => ids.includes(c.id)),
}));
vi.mock("@/sse/utils/logger.js", () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }));

const engine = await import("../../src/sse/services/keyAccess.js");
const helpers = await import("../../src/shared/utils/keyAccess.js");
const { keyAccessDeniedMessage, KEY_ACCESS_MAX_ENTRIES } = await import("../../src/shared/constants/keyAccess.js");

function key(id, access) {
  fx.keys[`sk-${id}`] = { id, name: `key-${id}`, isActive: true, access };
}
const req = (k, { header = "Authorization", query = false } = {}) => {
  const headers = {};
  if (k && !query) headers[header] = header === "Authorization" ? `Bearer ${k}` : k;
  const url = `http://localhost/v1/chat/completions${query && k ? `?key=${k}` : ""}`;
  return new Request(url, { method: "POST", headers });
};
const ctxFor = (k, opts) => engine.getKeyAccessContext(req(k, opts));
async function status(k, model) {
  const r = await engine.enforceKeyAccess(await ctxFor(k), model);
  return r ? r.status : 200;
}

beforeEach(() => {
  fx.keys = {};
  key("open", { restricted: false, allow: [] });
  key("combo", { restricted: true, allow: ["main"] }); // case differs from combo "Main" on purpose
  key("b", { restricted: true, allow: ["openai/MODEL-B"] });
  key("empty", { restricted: true, allow: [] });
  key("cx", { restricted: true, allow: ["cx/gpt-5"] });
  key("node", { restricted: true, allow: ["mock/glm-4"] });
  key("tavily", { restricted: true, allow: ["tavily", "Main"] });
  key("prov-oa", { restricted: true, allow: [], allowedProviders: ["openai"] });
  key("conn-oa", { restricted: true, allow: [], allowedProviders: ["openai"], allowedConnections: ["conn-oa-1"] });
  key("hierarchical", { restricted: true, allow: [], allowedProviders: ["openai", "anthropic"], allowedConnections: ["conn-oa-1"] });
});

describe("unrestricted passthrough", () => {
  it("no key, unknown key and unrestricted key all yield no context (today's behaviour)", async () => {
    expect(await ctxFor(null)).toBeNull();
    expect(await ctxFor("sk-nope")).toBeNull();
    expect(await ctxFor("sk-open")).toBeNull();
    for (const m of ["Main", "openai/model-a", "fast", "anything/at-all"]) {
      expect(await status("sk-open", m)).toBe(200);
    }
  });
  it("every gate is a no-op with a null context", async () => {
    expect(await engine.enforceKeyAccess(null, "x")).toBeNull();
    expect(await engine.enforceKeyAccessResolved(null, "x", null, null)).toBeNull();
    expect(await engine.enforceKeyAccessProvider(null, "x", null)).toBeNull();
    const list = [{ id: "a" }];
    expect(await engine.filterModelsListForKey(null, list)).toBe(list);
    expect(await engine.filterAdapterModels(null, ["a", "b"], ["a"])).toEqual(["a", "b"]);
  });
});

describe("restricted: allow by exact model", () => {
  it("allows the listed model, denies others", async () => {
    expect(await status("sk-b", "openai/model-b")).toBe(200);
    expect(await status("sk-b", "openai/model-a")).toBe(403);
    expect(await status("sk-b", "openai/model-b-plus")).toBe(403); // exact, not prefix
  });
  it("allows a combo if any member is allowed (Rule #3 dynamic pruning), denies if all members are denied", async () => {
    // combo "Main" has ["openai/model-a", "openai/model-b"]. sk-b allows model-b, so Main is accessible
    expect(await status("sk-b", "Main")).toBe(200);
    // combo "other" only has ["openai/model-c"], which sk-b does not allow -> denied
    expect(await status("sk-b", "other")).toBe(403);
  });
});

describe("restricted: allow by combo", () => {
  it("allows the listed combo", async () => {
    expect(await status("sk-combo", "Main")).toBe(200);
  });
  it("combo members are NOT directly callable by name (only via the combo)", async () => {
    expect(await status("sk-combo", "openai/model-a")).toBe(403);
    expect(await status("sk-combo", "openai/model-b")).toBe(403);
    expect(await status("sk-combo", "fast")).toBe(403); // alias of a member
  });
  it("other combos are denied", async () => {
    expect(await status("sk-combo", "other")).toBe(403);
  });
});

describe("restricted: allowedProviders & allowedConnections", () => {
  it("allows all models under allowedProviders when allow list is empty", async () => {
    expect(await status("sk-prov-oa", "openai/model-a")).toBe(200);
    expect(await status("sk-prov-oa", "openai/model-b")).toBe(200);
    expect(await status("sk-prov-oa", "fast")).toBe(200); // alias resolving to openai/model-a
    expect(await status("sk-prov-oa", "Main")).toBe(200); // combo whose members belong to openai
    expect(await status("sk-prov-oa", "cx/gpt-5")).toBe(403); // provider codex not allowed
    expect(await status("sk-prov-oa", "anthropic/claude-3-5")).toBe(403); // provider anthropic not allowed
  });

  it("filters out combo members with disallowed providers (Rule #3)", async () => {
    const ctx = await ctxFor("sk-prov-oa");
    const pruned = await engine.pruneComboModelsForKey(ctx, ["openai/model-a", "anthropic/claude-3-5", "openai/model-b"]);
    expect(pruned).toEqual(["openai/model-a", "openai/model-b"]);
  });

  it("prunes combo models for model-restricted keys", async () => {
    const ctx = await ctxFor("sk-b");
    const pruned = await engine.pruneComboModelsForKey(ctx, ["openai/model-a", "openai/model-b", "openai/model-c"]);
    expect(pruned).toEqual(["openai/model-b"]);
  });

  it("pruneComboModelsForKey returns unchanged list for unrestricted or null context", async () => {
    expect(await engine.pruneComboModelsForKey(null, ["openai/model-a"])).toEqual(["openai/model-a"]);
    const ctxOpen = await ctxFor("sk-open");
    expect(await engine.pruneComboModelsForKey(ctxOpen, ["openai/model-a"])).toEqual(["openai/model-a"]);
  });

  it("getAllowedConnectionIdsForProvider respects allowedProviders and allowedConnections", async () => {
    // Unrestricted
    expect(await engine.getAllowedConnectionIdsForProvider(null, "openai")).toBeNull();
    expect(await engine.getAllowedConnectionIdsForProvider(await ctxFor("sk-open"), "openai")).toBeNull();

    // Provider allowlist without specific connection: returns null (all active accounts allowed)
    const ctxProv = await ctxFor("sk-prov-oa");
    expect(await engine.getAllowedConnectionIdsForProvider(ctxProv, "openai")).toBeNull();
    const deniedSet = await engine.getAllowedConnectionIdsForProvider(ctxProv, "anthropic");
    expect(deniedSet).toBeInstanceOf(Set);
    expect(deniedSet.size).toBe(0); // 0 allowed = forbidden

    // Specific connection allowlist
    const ctxConn = await ctxFor("sk-conn-oa");
    const connSet = await engine.getAllowedConnectionIdsForProvider(ctxConn, "openai");
    expect(connSet).toBeInstanceOf(Set);
    expect(connSet.has("conn-oa-1")).toBe(true);
    expect(connSet.has("conn-oa-2")).toBe(false);

    // Hierarchical (Rule #2 Opsi A):
    // openai has specific account conn-oa-1 -> returns Set([conn-oa-1])
    // anthropic is in allowedProviders with NO specific accounts -> returns null (all accounts permitted)
    const ctxHier = await ctxFor("sk-hierarchical");
    const hierOaSet = await engine.getAllowedConnectionIdsForProvider(ctxHier, "openai");
    expect(hierOaSet).toBeInstanceOf(Set);
    expect([...hierOaSet]).toEqual(["conn-oa-1"]);
    expect(await engine.getAllowedConnectionIdsForProvider(ctxHier, "anthropic")).toBeNull();
    // Non-allowed provider returns empty Set
    const hierGeminiSet = await engine.getAllowedConnectionIdsForProvider(ctxHier, "gemini");
    expect(hierGeminiSet).toBeInstanceOf(Set);
    expect(hierGeminiSet.size).toBe(0);
  });
});

describe("resolution cannot be used to bypass", () => {
  it("a model alias resolves to its target before matching", async () => {
    expect(await status("sk-b", "fast")).toBe(403); // fast -> openai/model-a
    expect(await status("sk-b", "bee")).toBe(200); // bee -> openai/model-b: same target, same answer
  });
  it("provider alias and full provider id are one target", async () => {
    expect(await status("sk-cx", "cx/gpt-5")).toBe(200);
    expect(await status("sk-cx", "codex/gpt-5")).toBe(200);
    expect(await status("sk-cx", "cx/gpt-5-mini")).toBe(403);
    expect(await status("sk-cx", "openai/gpt-5")).toBe(403); // same model name, other provider
  });
  it("custom-node prefix and node id are one target", async () => {
    expect(await status("sk-node", "mock/glm-4")).toBe(200);
    expect(await status("sk-node", "openai-compatible-chat-n1/glm-4")).toBe(200);
    expect(await status("sk-node", "mock/glm-5")).toBe(403);
  });
  it("bypass check: a case variant of a combo name that does NOT route to the combo is denied", async () => {
    // combo lookup is exact; "MAIN" routes to openai/MAIN, not to combo "Main"
    expect(await status("sk-combo", "MAIN")).toBe(403);
    expect(await status("sk-combo", "main")).toBe(403);
  });
  it("bypass check: the key is read the same way the middleware reads it (x-api-key, x-goog-api-key, ?key=)", async () => {
    expect(await engine.getKeyAccessContext(req("sk-empty", { header: "x-goog-api-key" }))).not.toBeNull();
    expect(await engine.getKeyAccessContext(req("sk-empty", { header: "x-api-key" }))).not.toBeNull();
    expect(await engine.getKeyAccessContext(req("sk-empty", { query: true }))).not.toBeNull();
  });
});

describe("case-insensitivity", () => {
  it("matches resolved model ids case-insensitively", async () => {
    expect(await status("sk-b", "openai/Model-B")).toBe(200);
    expect(await status("sk-b", "OpenAI/model-b")).toBe(200);
  });
  it("matches combo names case-insensitively (allow 'main' grants combo 'Main')", async () => {
    expect(await status("sk-combo", "Main")).toBe(200);
  });
});

describe("empty list blocks everything", () => {
  it("denies combos, models, aliases, search providers and filters /v1/models to nothing", async () => {
    for (const m of ["Main", "other", "openai/model-a", "fast", "cx/gpt-5"]) expect(await status("sk-empty", m)).toBe(403);
    const ctx = await ctxFor("sk-empty");
    expect((await engine.enforceKeyAccessProvider(ctx, "tavily", null)).status).toBe(403);
    expect((await engine.enforceKeyAccessResolved(ctx, "openai/model-a", "openai", "model-a")).status).toBe(403);
    expect(await engine.filterModelsListForKey(ctx, [{ id: "Main", owned_by: "combo" }, { id: "openai/model-a", owned_by: "openai" }])).toEqual([]);
  });
});

describe("403 response shape", () => {
  it("is an OpenAI-style error that names only the requested model", async () => {
    const r = await engine.enforceKeyAccess(await ctxFor("sk-b"), "openai/model-a");
    expect(r.status).toBe(403);
    expect(r.headers.get("content-type")).toContain("application/json");
    const body = await r.json();
    expect(body).toEqual({ error: { message: keyAccessDeniedMessage("openai/model-a"), type: expect.any(String), code: expect.any(String) } });
    expect(JSON.stringify(body)).not.toContain("key-b"); // no key name
    expect(JSON.stringify(body)).not.toContain("MODEL-B"); // no allow list
  });
  it("a missing model is denied for a restricted key (unverifiable target)", async () => {
    const ctx = await ctxFor("sk-b");
    expect((await engine.enforceKeyAccessResolved(ctx, "", "xai", null)).status).toBe(403);
    expect((await engine.enforceKeyAccess(ctx, "")).status).toBe(403);
  });
});

describe("provider-as-model (search / fetch)", () => {
  it("allows a listed provider or a listed combo, denies others", async () => {
    const ctx = await ctxFor("sk-tavily");
    expect(await engine.enforceKeyAccessProvider(ctx, "tavily", null)).toBeNull();
    expect(await engine.enforceKeyAccessProvider(ctx, "TAVILY", null)).toBeNull();
    expect((await engine.enforceKeyAccessProvider(ctx, "exa", null)).status).toBe(403);
    expect(await engine.enforceKeyAccessProvider(ctx, "Main", ["tavily"])).toBeNull();
    expect((await engine.enforceKeyAccessProvider(ctx, "other", ["exa"])).status).toBe(403);
  });
});

describe("/v1/models filtering", () => {
  const list = [
    { id: "Main", object: "model", owned_by: "combo" },
    { id: "other", object: "model", owned_by: "combo" },
    { id: "openai/model-a", object: "model", owned_by: "openai" },
    { id: "openai/model-b", object: "model", owned_by: "openai" },
    { id: "cx/gpt-5", object: "model", owned_by: "cx" },
    { id: "mock/glm-4", object: "model", owned_by: "mock" },
    { id: "tavily/search", object: "model", kind: "webSearch", owned_by: "tavily" },
    { id: "exa/search", object: "model", kind: "webSearch", owned_by: "exa" },
  ];
  const ids = async (k) => (await engine.filterModelsListForKey(await ctxFor(k), list)).map((m) => m.id);
  it("lists only the allowed combos and models for each key", async () => {
    expect(await ids("sk-combo")).toEqual(["Main"]);
    expect(await ids("sk-b")).toEqual(["Main", "openai/model-b"]); // Main included due to Rule #3 dynamic pruning
    expect(await ids("sk-cx")).toEqual(["cx/gpt-5"]);
    expect(await ids("sk-node")).toEqual(["mock/glm-4"]);
    expect(await ids("sk-tavily")).toEqual(["Main", "tavily/search"]);
    expect(await ids("sk-empty")).toEqual([]);
    expect(await ids("sk-prov-oa")).toEqual(["Main", "other", "openai/model-a", "openai/model-b"]);
  });
  it("leaves the list untouched for an unrestricted key", async () => {
    expect(await engine.filterModelsListForKey(await ctxFor("sk-open"), list)).toBe(list);
  });
});

describe("capacity-adapter models", () => {
  it("keeps original targets, drops adapter models the key may not call", async () => {
    const ctx = await ctxFor("sk-combo");
    expect(await engine.filterAdapterModels(ctx, ["openai/model-a", "openai/model-b", "oc/vision"], ["openai/model-a", "openai/model-b"]))
      .toEqual(["openai/model-a", "openai/model-b"]);
    const ctxB = await ctxFor("sk-b");
    expect(await engine.filterAdapterModels(ctxB, ["openai/model-b", "openai/model-b"], ["openai/model-b"])).toEqual(["openai/model-b", "openai/model-b"]);
  });
});

describe("helpers: storage + validation", () => {
  it("columns -> access fails closed", () => {
    expect(helpers.keyAccessFromColumns(0, '["x"]')).toEqual({ restricted: false, allow: [], allowedProviders: [], allowedConnections: [] });
    expect(helpers.keyAccessFromColumns(null, null)).toEqual({ restricted: false, allow: [], allowedProviders: [], allowedConnections: [] }); // pre-migration row
    expect(helpers.keyAccessFromColumns(1, "not json")).toEqual({ restricted: true, allow: [], allowedProviders: [], allowedConnections: [] });
    expect(helpers.keyAccessFromColumns(1, '{"a":1}')).toEqual({ restricted: true, allow: [], allowedProviders: [], allowedConnections: [] });
    expect(helpers.keyAccessFromColumns(1, '[" a ", "A", "", 3, "b"]')).toEqual({ restricted: true, allow: ["a", "b"], allowedProviders: [], allowedConnections: [] });
    expect(
      helpers.keyAccessFromColumns(1, '{"allow":["a"],"allowedProviders":["openai"],"allowedConnections":["c1"]}')
    ).toEqual({
      restricted: true,
      allow: ["a"],
      allowedProviders: ["openai"],
      allowedConnections: ["c1"],
    });
  });
  it("access -> columns", () => {
    expect(helpers.keyAccessToColumns(undefined)).toEqual({
      accessRestricted: 0,
      accessAllow: '{"allow":[],"allowedProviders":[],"allowedConnections":[]}',
    });
    expect(helpers.keyAccessToColumns({ restricted: true, allow: ["x", "X"], allowedProviders: ["p1"], allowedConnections: ["c1"] })).toEqual({
      accessRestricted: 1,
      accessAllow: '{"allow":["x"],"allowedProviders":["p1"],"allowedConnections":["c1"]}',
    });
    expect(helpers.keyAccessToColumns({ restricted: false, allow: ["x"] })).toEqual({
      accessRestricted: 0,
      accessAllow: '{"allow":[],"allowedProviders":[],"allowedConnections":[]}',
    });
  });
  it("input validation rejects rather than repairs", () => {
    const v = helpers.validateKeyAccessInput;
    expect(v({ restricted: true, allow: [" Main ", "main", "cx/gpt-5"] })).toEqual({
      ok: true,
      value: { restricted: true, allow: ["Main", "cx/gpt-5"], allowedProviders: [], allowedConnections: [] },
    });
    expect(v({
      restricted: true,
      allow: ["Main"],
      allowedProviders: [" OpenAI "],
      allowedConnections: [" conn-1 "],
    })).toEqual({
      ok: true,
      value: { restricted: true, allow: ["Main"], allowedProviders: ["OpenAI"], allowedConnections: ["conn-1"] },
    });
    expect(v({ restricted: false })).toEqual({
      ok: true,
      value: { restricted: false, allow: [], allowedProviders: [], allowedConnections: [] },
    });
    expect(v(null).ok).toBe(false);
    expect(v([]).ok).toBe(false);
    expect(v({ restricted: "yes", allow: [] }).ok).toBe(false);
    expect(v({ restricted: true, allow: "Main" }).ok).toBe(false);
    expect(v({ restricted: true, allow: [1] }).ok).toBe(false);
    expect(v({ restricted: true, allow: [], mode: "deny" }).ok).toBe(false); // no deny mode
    expect(v({ restricted: true, allow: [], allowedProviders: "openai" }).ok).toBe(false);
    expect(v({ restricted: true, allow: [], allowedConnections: "conn1" }).ok).toBe(false);
    expect(v({ restricted: true, allow: Array.from({ length: KEY_ACCESS_MAX_ENTRIES + 1 }, (_, i) => `m${i}`) }).ok).toBe(false);
    expect(v({ restricted: true, allow: ["x".repeat(300)] }).ok).toBe(false);
  });
});
