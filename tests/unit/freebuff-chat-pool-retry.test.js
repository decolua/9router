import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderConnections: vi.fn(),
  getSettings: vi.fn(),
  getProxyPoolById: vi.fn(),
  getModelInfo: vi.fn(),
  handleChatCore: vi.fn(),
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  markAccountUnavailable: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: mocks.getProviderConnections,
  getSettings: mocks.getSettings,
  updateProviderConnection: vi.fn(),
  getProxyPools: vi.fn(),
  validateApiKey: vi.fn(),
  getApiKeyMetadata: vi.fn(),
  touchApiKey: vi.fn(),
  getObservedConnectionModelLock: vi.fn(() => null),
}));
vi.mock("@/models", () => ({
  getProxyPoolById: mocks.getProxyPoolById,
  listProxyPoolFitness: vi.fn(async () => []),
}));
vi.mock("../../src/sse/services/model.js", () => ({ getModelInfo: mocks.getModelInfo, getComboModels: vi.fn() }));
vi.mock("../../src/sse/services/auth.js", async (importOriginal) => ({
  ...(await importOriginal()),
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(),
  isValidApiKey: vi.fn(),
  getApiKeyPolicyError: vi.fn(),
}));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ updateProviderCredentials: vi.fn(), checkAndRefreshToken: mocks.checkAndRefreshToken }));
vi.mock("../../open-sse/translator/index.js", () => ({ register: vi.fn(), translateRequest: vi.fn() }));
vi.mock("../../open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));
vi.mock("../../open-sse/services/combo.js", () => ({ handleComboChat: vi.fn(), handleFusionChat: vi.fn(), detectRequiredCapabilities: vi.fn(() => new Set()) }));
vi.mock("../../open-sse/services/capacityAdapter.js", () => ({ augmentModelsWithCapacityAdapter: vi.fn((models) => models), withCapacityAdapterStripping: vi.fn((handler) => handler), getActiveAdapterStrategy: vi.fn() }));
vi.mock("@/lib/pxpipe/loader.js", () => ({ getTransform: vi.fn() }));
vi.mock("@/lib/pxpipe/events.js", () => ({ appendPxpipeEvent: vi.fn() }));

const { getProviderCredentials } = await import("../../src/sse/services/auth.js");
const { handleChat } = await import("../../src/sse/handlers/chat.js");
const { createTerminalAccumulator, routeFiniteFreebuff } = await import("../../src/sse/handlers/freebuffRouting.js");

function connection(proxyPoolId, proxyPoolIds = [], id = "connection-a") {
  return {
    id,
    provider: "freebuff",
    isActive: true,
    name: `Freebuff ${id}`,
    accessToken: "test",
    priority: id === "connection-a" ? 1 : 2,
    providerSpecificData: { proxyPoolId, proxyPoolIds },
  };
}

function pool(id) {
  return { id, isActive: true, proxyUrl: `http://${id}.test`, noProxy: "", type: "http", strictProxy: true };
}

describe("Freebuff proxy-pool retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: false, providerStrategies: {}, fallbackStrategy: "fill-first" });
    mocks.getModelInfo.mockResolvedValue({ provider: "freebuff", model: "model-a" });
    mocks.getProxyPoolById.mockImplementation(async (id) => pool(id));
  });

  it("returns strict no-fit credentials when a real single-pool assignment is excluded", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("pool-a")]);

    const initial = await getProviderCredentials("freebuff", null, "model-a");
    const excluded = await getProviderCredentials("freebuff", null, "model-a", { excludePoolIds: new Set(["pool-a"]) });

    expect(initial.providerSpecificData.proxyPoolId).toBe("pool-a");
    expect(excluded.providerSpecificData).toMatchObject({ proxyPoolId: null, noFitPool: true, strictProxy: true });
  });

  it("stops after a single assigned pool becomes excluded without marking the account unavailable", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("pool-a")]);
    mocks.handleChatCore.mockResolvedValueOnce({ success: false, status: 409, error: "limited", poolScoped: { poolId: "pool-a", reason: "limited_ip" } });

    const response = await handleChat(new Request("http://router.test/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "freebuff/model-a", messages: [{ role: "user", content: "hello" }] }),
    }));

    expect(response.status).toBe(503);
    expect(mocks.handleChatCore).toHaveBeenCalledTimes(1);
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("retries through an eligible real alternate pool without marking the account unavailable", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("", ["pool-a", "pool-b"])]);
    mocks.handleChatCore
      .mockResolvedValueOnce({ success: false, status: 409, error: "limited", poolScoped: { poolId: "pool-a", reason: "limited_ip" } })
      .mockResolvedValueOnce({ success: true, response: new Response("ok") });

    const response = await handleChat(new Request("http://router.test/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "freebuff/model-a", messages: [{ role: "user", content: "hello" }] }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.handleChatCore.mock.calls.map(([options]) => options.credentials.providerSpecificData.proxyPoolId)).toEqual(["pool-a", "pool-b"]);
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("exhausts A/a then A/b before selecting B/c and deduplicates pools", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      connection("", ["pool-a", "pool-a", "pool-b"], "connection-a"),
      connection("", ["pool-c"], "connection-b"),
    ]);
    mocks.handleChatCore
      .mockResolvedValueOnce({ success: false, status: 409, error: "limited-a", poolScoped: { poolId: "pool-a" } })
      .mockResolvedValueOnce({ success: false, status: 409, error: "limited-b", poolScoped: { poolId: "pool-b" } })
      .mockResolvedValueOnce({ success: true, response: new Response("ok") });
    const response = await handleChat(new Request("http://router.test/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "freebuff/model-a", messages: [] }) }));
    expect(response.status).toBe(200);
    expect(mocks.handleChatCore.mock.calls.map(([value]) => [value.connectionId, value.credentials.providerSpecificData.proxyPoolId])).toEqual([
      ["connection-a", "pool-a"], ["connection-a", "pool-b"], ["connection-b", "pool-c"],
    ]);
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("keeps frozen eligible candidates after source mutation and skips no-fit candidates", async () => {
    const selected = { connectionId: "connection-a", _connection: connection("", ["pool-a", "pool-b", "pool-c"]) };
    const resolvePool = vi.fn(async (_selected, id) => id === "pool-b" ? null : { ...selected, providerSpecificData: { proxyPoolId: id } });
    const dispatch = vi.fn().mockImplementationOnce(async () => {
      selected._connection.providerSpecificData.proxyPoolIds.push("pool-d");
      return { success: false, status: 409, error: "limited", poolScoped: { poolId: "pool-a" } };
    }).mockResolvedValueOnce({ success: false, status: 409, error: "limited", poolScoped: { poolId: "pool-c" } });
    const routed = await routeFiniteFreebuff({ provider: "freebuff", model: "model-a", select: vi.fn().mockResolvedValueOnce(selected).mockResolvedValueOnce(null), resolvePool, dispatch, shouldFallback: vi.fn(async () => false) });
    expect(routed.terminal.kind).toBe("pool");
    expect(resolvePool.mock.calls.map(([, id]) => id)).toEqual(["pool-a", "pool-b", "pool-c"]);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it("skips an empty A snapshot, selects B once, and bounds dispatches to snapshots", async () => {
    const accountA = { connectionId: "connection-a", _connection: connection("", [], "connection-a") };
    const accountB = { connectionId: "connection-b", _connection: connection("", ["pool-b"], "connection-b") };
    const select = vi.fn().mockResolvedValueOnce(accountA).mockResolvedValueOnce(accountB).mockResolvedValueOnce(accountB);
    const dispatch = vi.fn().mockResolvedValue({ success: false, status: 409, error: "limited", poolScoped: { poolId: "pool-b" } });
    const routed = await routeFiniteFreebuff({
      provider: "freebuff", model: "model-a", select,
      resolvePool: vi.fn(async (selected, id) => ({ ...selected, providerSpecificData: { proxyPoolId: id } })),
      dispatch, shouldFallback: vi.fn(async () => false),
    });
    expect(routed.terminal.kind).toBe("pool");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(3);
  });

  it("builds one snapshot per identity and rejects a repeated excluded account", async () => {
    const account = { connectionId: "connection-a", _connection: connection("", ["pool-a"], "connection-a") };
    const resolvePool = vi.fn(async (selected, id) => ({ ...selected, providerSpecificData: { proxyPoolId: id } }));
    const routed = await routeFiniteFreebuff({
      provider: "freebuff", model: "model-a",
      select: vi.fn().mockResolvedValueOnce(account).mockResolvedValueOnce(account),
      resolvePool,
      dispatch: vi.fn().mockResolvedValue({ success: false, status: 409, error: "limited", poolScoped: { poolId: "pool-a" } }),
      shouldFallback: vi.fn(async () => false),
    });
    expect(resolvePool).toHaveBeenCalledTimes(1);
    expect(routed.excludedConnectionIds).toEqual(new Set(["connection-a"]));
  });

  it("prioritizes earliest quota over pool exhaustion and redacts terminal data", () => {
    const terminal = createTerminalAccumulator();
    terminal.poolExhausted();
    terminal.record({ status: 502, error: `Authorization: Bearer secret https://example.test/${"x".repeat(400)}\n{raw:body}` });
    terminal.record({ status: 429, resetsAtMs: Date.now() + 1000, error: "Cookie: session-secret" });
    const result = terminal.value();
    expect(result).toMatchObject({ kind: "quota", status: 429 });
    expect(result.message).not.toContain("session-secret");
    expect(result.message.length).toBeLessThanOrEqual(256);
  });

  it("redacts every sensitive terminal field form", () => {
    const cases = [
      ["token=fake-token-value", "fake-token-value"],
      ["Cookie: session=fake; refresh=still-visible", "still-visible"],
      ["Set-Cookie: session=fake; HttpOnly; refresh=still-visible", "still-visible"],
      ["Authorization: Basic fake-secret extra-visible", "extra-visible"],
      ["headers: x=fake, y=still-visible", "still-visible"],
      ["Bearer fake-bearer https://secret.test/path\ncontrol\u0000", "fake-bearer"],
      [`${"x".repeat(300)} token=fake-token-value`, "fake-token-value"],
    ];
    for (const [input, secret] of cases) {
      const terminal = createTerminalAccumulator();
      terminal.record({ status: 502, error: input });
      const result = terminal.value();
      expect(result.message).not.toContain(secret);
      expect(result.message.length).toBeLessThanOrEqual(256);
    }
  });

  it("returns an accumulator terminal instead of forwarding a raw provider response", async () => {
    const selected = { connectionId: "connection-a", _connection: connection("", ["pool-a"]) };
    const raw = new Response("Cookie: session=fake; refresh=still-visible", { status: 502 });
    const routed = await routeFiniteFreebuff({
      provider: "freebuff", model: "model-a", select: vi.fn().mockResolvedValue(selected),
      resolvePool: vi.fn(async (value, id) => ({ ...value, providerSpecificData: { proxyPoolId: id } })),
      dispatch: vi.fn().mockResolvedValue({ success: false, status: 502, error: "Authorization: Basic fake-secret extra-visible", response: raw }),
      shouldFallback: vi.fn(async () => false),
    });
    expect(routed.response).toBeUndefined();
    expect(routed.terminal.message).not.toContain("fake-secret");
    expect(routed.terminal.message.length).toBeLessThanOrEqual(256);
  });

  it("rejects an untrusted forced pool", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("", ["pool-a"])]);
    await expect(getProviderCredentials("freebuff", null, "model-a", { forceProxyPoolId: "pool-rogue", allowedProxyPoolIds: ["pool-a"] })).resolves.toBeNull();
  });

  it("locks and excludes A after a non-pool quota failure before B succeeds", async () => {
    mocks.getProviderConnections.mockResolvedValue([
      connection("", ["pool-a"], "connection-a"),
      connection("", ["pool-b"], "connection-b"),
    ]);
    mocks.markAccountUnavailable.mockResolvedValueOnce({ shouldFallback: true });
    mocks.handleChatCore
      .mockResolvedValueOnce({ success: false, status: 403, error: "Account usage limit reached", resetsAtMs: Date.now() + 60_000 })
      .mockResolvedValueOnce({ success: true, response: new Response("ok") });
    const response = await handleChat(new Request("http://router.test/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "freebuff/model-a", messages: [] }) }));
    expect(response.status).toBe(200);
    expect(mocks.markAccountUnavailable).toHaveBeenCalledWith("connection-a", 403, "Account usage limit reached", "freebuff", "model-a", expect.any(Number));
    expect(mocks.handleChatCore.mock.calls.map(([value]) => value.connectionId)).toEqual(["connection-a", "connection-b"]);
  });

  it("returns sanitized terminal when a non-pool failure cannot fall back", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("", ["pool-a"])]);
    mocks.markAccountUnavailable.mockResolvedValueOnce({ shouldFallback: false });
    mocks.handleChatCore.mockResolvedValueOnce({ success: false, status: 502, error: "Authorization: Basic fake-secret extra-visible", response: new Response("raw", { status: 502 }) });
    const response = await handleChat(new Request("http://router.test/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "freebuff/model-a", messages: [] }) }));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("fake-secret");
  });

  it("returns bounded pool exhaustion without marking the Freebuff account unavailable", async () => {
    mocks.getProviderConnections.mockResolvedValue([connection("", ["pool-a", "pool-b", "pool-c"])]);
    mocks.handleChatCore.mockImplementation(async ({ credentials }) => ({
      success: false, status: 409, error: "limited", poolScoped: { poolId: credentials.providerSpecificData.proxyPoolId },
    }));
    const response = await handleChat(new Request("http://router.test/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: "freebuff/model-a", messages: [] }) }));
    expect(response.status).toBe(503);
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });
});
