// Per-key access patterns: wildcard allow ("oc/*", "*claude*"), deny entries
// ("!opus" / "-haiku"), deny-only lists, and the quota/pause gate
// (checkApiKeyQuota) that applies to known keys regardless of requireApiKey.
import { describe, it, expect, vi } from "vitest";

const fx = vi.hoisted(() => ({
  combos: [{ id: "c1", name: "Main", models: ["openai/model-a"] }],
  keys: {},
}));

vi.mock("@/lib/db/repos/combosRepo.js", () => ({ getCombos: async () => fx.combos }));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({
  getApiKeyByKey: async (k) => fx.keys[k] || null,
}));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async () => [],
  getSettings: async () => ({}),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: async () => ({}),
  pickProxyPoolId: async () => null,
}));
vi.mock("@/sse/services/antigravityQuota.js", () => ({
  getAntigravityQuotaCache: () => null,
  getAntigravityModelQuota: () => null,
}));
vi.mock("@/sse/utils/logger.js", () => ({
  maskKey: (k) => k,
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
}));
vi.mock("@/sse/services/model.js", () => ({
  // "oc/x" resolves to provider id "opencode" like the real alias map.
  getModelInfo: async (s) => {
    if (typeof s !== "string" || !s.includes("/")) return null;
    const [rawProvider, ...rest] = s.split("/");
    const provider = rawProvider === "oc" ? "opencode" : rawProvider;
    return { provider, model: rest.join("/") };
  },
  getComboModels: async (name) => (fx.combos.some((c) => c.name === name) ? fx.combos.find((c) => c.name === name).models : null),
}));

const keyAccess = await import("../../src/sse/services/keyAccess.js");
const { checkApiKeyQuota } = await import("../../src/sse/services/auth.js");

const ctx = (allow) => ({ keyId: "k1", keyName: "test-key", allow, _sets: null });

describe("keyAccess wildcard + deny patterns", () => {
  it("provider wildcard allows that provider's models (alias or id form)", async () => {
    const c = ctx(["oc/*"]);
    expect(await keyAccess.enforceKeyAccess(c, "oc/muse-spark")).toBeNull();
    expect(await keyAccess.enforceKeyAccess(c, "opencode/anything")).toBeNull();
    expect(await keyAccess.enforceKeyAccess(c, "openai/gpt-4o")).not.toBeNull();
  });

  it("glob wildcard matches model substrings", async () => {
    const c = ctx(["*claude*"]);
    expect(await keyAccess.enforceKeyAccess(c, "anthropic/claude-3-5-sonnet")).toBeNull();
    expect(await keyAccess.enforceKeyAccess(c, "anthropic/gpt-4o")).not.toBeNull();
  });

  it("deny entry excludes models a positive rule would allow", async () => {
    const c = ctx(["*claude*", "-haiku"]);
    expect(await keyAccess.enforceKeyAccess(c, "anthropic/claude-3-5-sonnet")).toBeNull();
    expect(await keyAccess.enforceKeyAccess(c, "anthropic/claude-3-haiku")).not.toBeNull();
    expect(await keyAccess.enforceKeyAccess(c, "anthropic/gpt-4o")).not.toBeNull();
  });

  it("deny-only list allows everything except the denied term", async () => {
    const c = ctx(["!opus"]);
    expect(await keyAccess.enforceKeyAccess(c, "anthropic/claude-3-5-sonnet")).toBeNull();
    expect(await keyAccess.enforceKeyAccess(c, "openai/gpt-4o")).toBeNull();
    expect(await keyAccess.enforceKeyAccess(c, "anthropic/claude-3-opus")).not.toBeNull();
    // deny-only keys keep combo access
    expect(await keyAccess.enforceKeyAccess(c, "Main")).toBeNull();
  });

  it("enforceKeyAccessResolved honors deny + wildcard on resolved ids", async () => {
    const c = ctx(["oc/*", "-muse"]);
    expect(await keyAccess.enforceKeyAccessResolved(c, "oc/other", "opencode", "other")).toBeNull();
    expect(await keyAccess.enforceKeyAccessResolved(c, "oc/muse-spark", "opencode", "muse-spark")).not.toBeNull();
  });

  it("filterModelsListForKey keeps only allowed, non-denied entries", async () => {
    const c = ctx(["*claude*", "-haiku"]);
    const list = [
      { id: "anthropic/claude-3-5-sonnet", owned_by: "anthropic" },
      { id: "anthropic/claude-3-haiku", owned_by: "anthropic" },
      { id: "openai/gpt-4o", owned_by: "openai" },
    ];
    const out = await keyAccess.filterModelsListForKey(c, list);
    expect(out.map((e) => e.id)).toEqual(["anthropic/claude-3-5-sonnet"]);
  });

  it("exact-match entries still work alongside patterns", async () => {
    const c = ctx(["openai/gpt-4o", "oc/*"]);
    expect(await keyAccess.enforceKeyAccess(c, "openai/gpt-4o")).toBeNull();
    expect(await keyAccess.enforceKeyAccess(c, "openai/gpt-4o-mini")).not.toBeNull();
  });
});

describe("checkApiKeyQuota gate", () => {
  it("passes unknown or missing keys when keys are not required (local mode)", async () => {
    expect(await checkApiKeyQuota(null, false)).toBeNull();
    expect(await checkApiKeyQuota("sk-unknown", false)).toBeNull();
  });

  it("rejects missing/unknown keys when requireApiKey is on", async () => {
    expect((await checkApiKeyQuota(null, true)).status).toBe(401);
    expect((await checkApiKeyQuota("sk-unknown", true)).status).toBe(401);
  });

  it("rejects a paused key even in local mode", async () => {
    fx.keys["sk-paused"] = { isActive: false, tokenLimit: 0, usedTokens: 0 };
    const r = await checkApiKeyQuota("sk-paused", false);
    expect(r.status).toBe(401);
    expect(r.error).toContain("paused");
  });

  it("returns 429 when the token quota is reached", async () => {
    fx.keys["sk-quota"] = { isActive: true, tokenLimit: 1000, usedTokens: 1000 };
    const r = await checkApiKeyQuota("sk-quota", false);
    expect(r.status).toBe(429);
    expect(r.error).toContain("Token limit exceeded");
  });

  it("passes a healthy key within quota", async () => {
    fx.keys["sk-ok"] = { isActive: true, tokenLimit: 1000, usedTokens: 10 };
    expect(await checkApiKeyQuota("sk-ok", false)).toBeNull();
    expect(await checkApiKeyQuota("sk-ok", true)).toBeNull();
  });
});

describe("resolved regex rules", () => {
  it("supports regex and exclusions against canonical model names", async () => {
    const c = ctx(["/^claude-(sonnet|opus)$/i", "!opus"]);
    expect(await keyAccess.enforceKeyAccessResolved(c, "friendly-alias", "anthropic", "claude-sonnet")).toBeNull();
    expect(await keyAccess.enforceKeyAccessResolved(c, "friendly-alias", "anthropic", "claude-opus")).not.toBeNull();
    expect(await keyAccess.enforceKeyAccessResolved(c, "claude-sonnet", "openai", "gpt-4o")).not.toBeNull();
  });
  it("invalid regex cannot open access and global regex stays deterministic", async () => {
    expect(await keyAccess.enforceKeyAccessResolved(ctx(["/[/"]), "x", "opencode", "a")).not.toBeNull();
    const c = ctx(["/^opencode\//g"]);
    for (let i = 0; i < 3; i++) expect(await keyAccess.enforceKeyAccessResolved(c, "alias", "opencode", "a")).toBeNull();
  });
  it("a provider wildcard cannot allow a misleading alias routed to a different provider", async () => {
    expect(await keyAccess.enforceKeyAccessResolved(ctx(["oc/*"]), "oc/fake", "openai", "gpt-4o")).not.toBeNull();
  });
});
