import { beforeEach, describe, expect, it, vi } from "vitest";

const fx = vi.hoisted(() => ({ connections: [], keys: {}, settings: {} }));
vi.mock("@/lib/localDb", () => ({
  getProviderConnections: async ({ provider }) => fx.connections.filter((c) => c.provider === provider && c.isActive),
  getSettings: async () => fx.settings,
  getProxyPools: async () => [],
  validateApiKey: vi.fn(),
  updateProviderConnection: vi.fn(),
}));
vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({ getApiKeyByKey: async (key) => fx.keys[key] || null }));
vi.mock("@/lib/network/connectionProxy", () => ({ resolveConnectionProxyConfig: async () => ({}), pickProxyPoolId: vi.fn() }));
vi.mock("@/sse/services/antigravityQuota.js", () => ({ getAntigravityQuotaCache: () => new Map(), getAntigravityModelQuota: vi.fn() }));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { getProviderCredentials } = await import("@/sse/services/auth.js");
const { getAllowedAccountIds, getKeyAccessContext } = await import("@/sse/services/keyAccess.js");
const request = (key = "sk-limited", header = "Authorization") => new Request("http://localhost/v1/chat/completions", {
  headers: { [header]: header === "Authorization" ? `Bearer ${key}` : key },
});
const select = (excluded = null, options = {}) => getProviderCredentials("claude", excluded, "model", { request: request(), ...options });

beforeEach(() => {
  fx.connections = ["one", "two", "three"].map((id) => ({ id, provider: "claude", isActive: true, apiKey: `secret-${id}` }));
  fx.keys = { "sk-limited": { access: { restricted: false, allow: [], accountsRestricted: true, accountIds: ["two"] } } };
  fx.settings = {};
});

describe("API key account restrictions", () => {
  it("pins every request to the only allowed account despite provider ordering", async () => {
    for (let i = 0; i < 4; i++) expect((await select()).connectionId).toBe("two");
    expect(await getKeyAccessContext(request())).toBeNull();
  });
  it("retries only within the allowed subset", async () => {
    fx.keys["sk-limited"].access.accountIds = ["one", "two"];
    expect((await select()).connectionId).toBe("one");
    expect((await select(new Set(["one"]))).connectionId).toBe("two");
    expect(await select(new Set(["one", "two"]))).toBeNull();
  });
  it("does not allow preferred account IDs to bypass restrictions", async () => {
    expect((await select(null, { preferredConnectionId: "three" })).connectionId).toBe("two");
  });
  it("denies empty, malformed, deleted, inactive and foreign-provider account lists", async () => {
    for (const accountIds of [[], undefined, "two", ["deleted"], ["inactive"], ["foreign"]]) {
      fx.keys["sk-limited"].access.accountIds = accountIds;
      fx.connections.push({ id: "inactive", provider: "claude", isActive: false }, { id: "foreign", provider: "openai", isActive: true });
      expect(await select()).toBeNull();
    }
  });
  it("never escapes a model cooldown to an unauthorized account", async () => {
    fx.connections[1].modelLock_model = new Date(Date.now() + 60000).toISOString();
    expect(await select()).toMatchObject({ allRateLimited: true });
  });
  it("honors round-robin within the subset", async () => {
    fx.settings = { fallbackStrategy: "round-robin" };
    expect((await select()).connectionId).toBe("two");
  });
  it("denies virtual public providers for an account-restricted key", async () => {
    const { FREE_PROVIDERS } = await import("@/shared/constants/providers.js");
    const provider = Object.keys(FREE_PROVIDERS).find((id) => FREE_PROVIDERS[id].noAuth);
    expect(provider).toBeTruthy();
    expect(await getProviderCredentials(provider, null, null, { request: request() })).toBeNull();
  });
  it("recognizes every supported key header and query string", async () => {
    for (const header of ["Authorization", "x-api-key", "x-goog-api-key"]) {
      expect(await getAllowedAccountIds(request("sk-limited", header))).toEqual(["two"]);
    }
    expect(await getAllowedAccountIds(new Request("http://localhost/v1/models?key=sk-limited"))).toEqual(["two"]);
  });
  it("leaves existing unrestricted and internal requests unchanged", async () => {
    expect((await getProviderCredentials("claude")).connectionId).toBe("one");
    fx.keys["sk-limited"].access.accountsRestricted = false;
    expect((await select()).connectionId).toBe("one");
  });
});
