// Per-API-key account pinning: pure helpers, key lookup, and the hard filter in
// getProviderCredentials (selection, fallback and fail-closed behaviour).
import { beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({
  keys: {},
  conns: [],
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async ({ provider }) => fx.conns.filter((c) => c.provider === provider && c.isActive !== false),
  updateProviderConnection: vi.fn(async () => {}),
  getSettings: async () => ({ fallbackStrategy: "fill-first" }),
  getProxyPools: async () => [],
  validateApiKey: async () => true,
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  pickProxyPoolId: vi.fn(),
  resolveConnectionProxyConfig: async () => ({}),
}));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({ getApiKeyByKey: async (k) => fx.keys[k] || null }));
vi.mock("@/lib/db/repos/combosRepo.js", () => ({ getCombos: async () => [] }));
vi.mock("@/sse/utils/logger.js", () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }));

const helpers = await import("../../src/shared/utils/keyAccess.js");
const engine = await import("../../src/sse/services/keyAccess.js");
const { getProviderCredentials } = await import("../../src/sse/services/auth.js");

const req = (k) => new Request("http://localhost/v1/chat/completions", {
  method: "POST",
  headers: k ? { Authorization: `Bearer ${k}` } : {},
});

beforeEach(() => {
  fx.keys = {};
  fx.conns = [
    { id: "a1", provider: "openai", name: "personal", priority: 1, authType: "apikey", apiKey: "k-a1" },
    { id: "a2", provider: "openai", name: "work", priority: 2, authType: "apikey", apiKey: "k-a2" },
    { id: "a3", provider: "openai", name: "spare", priority: 3, authType: "apikey", apiKey: "k-a3" },
    { id: "c1", provider: "claude", name: "claude-one", priority: 1, authType: "apikey", apiKey: "k-c1" },
  ];
});

describe("helpers", () => {
  it("normalizeConnectionPins lower-cases providers, de-dups ids and drops empty providers", () => {
    expect(helpers.normalizeConnectionPins({ OpenAI: [" a1 ", "a1", "a2", 7, ""], claude: [], bad: "x" }))
      .toEqual({ openai: ["a1", "a2"] });
    expect(helpers.normalizeConnectionPins(null)).toEqual({});
    expect(helpers.normalizeConnectionPins([])).toEqual({});
  });

  it("round-trips through the DB columns and omits `connections` when there are no pins", () => {
    const cols = helpers.keyAccessToColumns({ restricted: false, allow: [], connections: { openai: ["a1"] } });
    expect(cols.accessConnections).toBe('{"openai":["a1"]}');
    expect(helpers.keyAccessFromColumns(0, "[]", cols.accessConnections))
      .toEqual({ restricted: false, allow: [], connections: { openai: ["a1"] } });

    expect(helpers.keyAccessToColumns({ restricted: false, allow: [] }).accessConnections).toBeNull();
    expect(helpers.keyAccessFromColumns(0, null, null)).toEqual({ restricted: false, allow: [] });
    expect(helpers.keyAccessFromColumns(1, '["m"]', "not json")).toEqual({ restricted: true, allow: ["m"] });
  });

  it("validateKeyAccessInput: `connections` is optional and validated", () => {
    const base = { restricted: false, allow: [] };
    expect(helpers.validateKeyAccessInput(base)).toEqual({ ok: true, value: base });
    expect(helpers.validateKeyAccessInput({ ...base, connections: { OpenAI: ["a1"] } }))
      .toEqual({ ok: true, value: { ...base, connections: { openai: ["a1"] } } });
    expect(helpers.validateKeyAccessInput({ ...base, connections: {} }))
      .toEqual({ ok: true, value: { ...base, connections: {} } });
    for (const bad of [null, [], "x", { openai: "a1" }, { openai: [1] }]) {
      expect(helpers.validateKeyAccessInput({ ...base, connections: bad }).ok).toBe(false);
    }
    expect(helpers.validateKeyAccessInput({ ...base, extra: 1 }).ok).toBe(false);
  });
});

describe("getKeyAllowedConnections", () => {
  beforeEach(() => {
    fx.keys["sk-pinned"] = { id: "k1", access: { restricted: false, allow: [], connections: { openai: ["a2"] } } };
    fx.keys["sk-open"] = { id: "k2", access: { restricted: false, allow: [] } };
  });

  it("returns the pinned ids for the pinned provider only", async () => {
    expect(await engine.getKeyAllowedConnections(req("sk-pinned"), "openai")).toEqual(new Set(["a2"]));
    expect(await engine.getKeyAllowedConnections(req("sk-pinned"), "claude")).toBeNull();
  });

  it("is null for no key, an unknown key and an unpinned key (today's behaviour)", async () => {
    expect(await engine.getKeyAllowedConnections(req(null), "openai")).toBeNull();
    expect(await engine.getKeyAllowedConnections(req("sk-nope"), "openai")).toBeNull();
    expect(await engine.getKeyAllowedConnections(req("sk-open"), "openai")).toBeNull();
    expect(await engine.getKeyAllowedConnections(null, "openai")).toBeNull();
  });

  it("does not create a model-access context for a pinned-but-unrestricted key", async () => {
    expect(await engine.getKeyAccessContext(req("sk-pinned"))).toBeNull();
  });
});

describe("getProviderCredentials with allowedConnectionIds", () => {
  it("without pins keeps today's selection (highest priority account)", async () => {
    const creds = await getProviderCredentials("openai", new Set(), "gpt-5");
    expect(creds.connectionId).toBe("a1");
  });

  it("only selects from the pinned accounts", async () => {
    const creds = await getProviderCredentials("openai", new Set(), "gpt-5", { allowedConnectionIds: new Set(["a2", "a3"]) });
    expect(creds.connectionId).toBe("a2");
  });

  it("fallback (exclude set) moves to the next pinned account and never leaves the set", async () => {
    const allowed = new Set(["a2", "a3"]);
    const second = await getProviderCredentials("openai", new Set(["a2"]), "gpt-5", { allowedConnectionIds: allowed });
    expect(second.connectionId).toBe("a3");
    const none = await getProviderCredentials("openai", new Set(["a2", "a3"]), "gpt-5", { allowedConnectionIds: allowed });
    expect(none).toBeNull(); // a1 is active but NOT pinned: must not be used
  });

  it("a preferred connection outside the pinned set is ignored", async () => {
    const creds = await getProviderCredentials("openai", new Set(), "gpt-5", {
      preferredConnectionId: "a1",
      allowedConnectionIds: new Set(["a3"]),
    });
    expect(creds.connectionId).toBe("a3");
  });

  it("fails closed when every pinned account is gone or inactive", async () => {
    fx.conns.find((c) => c.id === "a2").isActive = false;
    expect(await getProviderCredentials("openai", new Set(), "gpt-5", { allowedConnectionIds: new Set(["a2", "deleted"]) })).toBeNull();
  });

  it("pins on one provider do not affect another provider", async () => {
    const creds = await getProviderCredentials("claude", new Set(), "sonnet", { allowedConnectionIds: null });
    expect(creds.connectionId).toBe("c1");
  });
});
