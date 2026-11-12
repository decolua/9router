// DF-9ROUTER-56 C2 — a 404 for an id that exists in NO catalog must not blame
// credentials. "No active credentials for provider: openai" for a model that
// simply does not exist sends users hunting for a dead API key; the message
// must name the wrong model id and point at /v1/models instead. Ids the
// catalog DOES list (or that cannot be proven absent: nodes, passthrough
// providers, DB failures) keep the legacy credential wording — the fix only
// claims a miss it can prove.
//
// Driven through the real handleChat → real auth.js against a mocked store
// (same shape as no-credentials-guidance-54.test.js): the assertions cover the
// actual 404 branch (excludeConnectionIds.size === 0), not a copy of its
// message. Only the DB, usage persistence and token refresh are mocked; no
// network.
const fx = vi.hoisted(() => ({ connections: [] }));

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getProviderConnections: vi.fn(),
  updateProviderConnection: vi.fn(),
  validateApiKey: vi.fn(),
  getProxyPools: vi.fn(),
  getModelAliases: vi.fn(),
  getComboByName: vi.fn(),
  getProviderNodes: vi.fn(),
  getCustomModels: vi.fn(),
  checkAndRefreshToken: vi.fn(),
  updateProviderCredentials: vi.fn(),
  getApiKeyByKey: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getProviderConnections: mocks.getProviderConnections,
  updateProviderConnection: mocks.updateProviderConnection,
  validateApiKey: mocks.validateApiKey,
  getProxyPools: mocks.getProxyPools,
  getModelAliases: mocks.getModelAliases,
  getComboByName: mocks.getComboByName,
  getProviderNodes: mocks.getProviderNodes,
  getCustomModels: mocks.getCustomModels,
}));

vi.mock("@/lib/usageDb.js", () => ({
  appendRequestLog: vi.fn(async () => {}),
  saveRequestDetail: vi.fn(async () => {}),
  saveRequestUsage: vi.fn(async () => {}),
  trackPendingRequest: vi.fn(async () => {}),
}));

vi.mock("@/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: mocks.checkAndRefreshToken,
  updateProviderCredentials: mocks.updateProviderCredentials,
}));

vi.mock("@/lib/db/repos/apiKeysRepo.js", () => ({
  getApiKeyByKey: mocks.getApiKeyByKey,
}));

vi.mock("@/lib/db/repos/combosRepo.js", () => ({
  getCombos: async () => [],
}));

const { handleChat, modelNotInCatalogMessage } = await import("../../src/sse/handlers/chat.js");

// A registered, credential-required provider (real registry entry: alias
// "anthropic") with a well-formed but NONEXISTENT model id — the acceptance
// case. Compare noCredentialsGuidance's REQUESTED, which IS a real catalog id.
const REQUESTED = "anthropic/claude-nonexistent-model-56";
const REQUESTED_PROVIDER = "anthropic";

// A registered passthrough provider (accepts any model id upstream) — the
// catalog cannot prove a miss for it, so the legacy wording must survive.
const PASSTHROUGH_ALIAS = "mmf"; // mimo-free: noAuth + passthroughModels

async function chat(modelStr) {
  return handleChat(new Request("https://router.test/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer client-key" },
    body: JSON.stringify({ model: modelStr, messages: [{ role: "user", content: "hi" }], stream: false }),
  }));
}

describe("model-not-in-catalog 404 message (DF-9ROUTER-56 C2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fx.connections = [];
    mocks.getSettings.mockResolvedValue({});
    mocks.getModelAliases.mockResolvedValue({});
    mocks.getComboByName.mockResolvedValue(null);
    mocks.getProxyPools.mockResolvedValue([]);
    mocks.getProviderNodes.mockResolvedValue([]);
    mocks.getCustomModels.mockResolvedValue([]);
    mocks.validateApiKey.mockResolvedValue(true);
    mocks.updateProviderConnection.mockResolvedValue({});
    mocks.getApiKeyByKey.mockResolvedValue(null);
    mocks.checkAndRefreshToken.mockImplementation(async (_provider, credentials) => credentials);
    mocks.getProviderConnections.mockImplementation(async (filter = {}) => fx.connections.filter((c) => {
      if (filter?.provider && c.provider !== filter.provider) return false;
      if (filter?.isActive !== undefined && c.isActive !== filter.isActive) return false;
      return true;
    }));
  });

  it("nonexistent model on a zero-connection install → 'not found in catalog', NOT credential wording", async () => {
    const response = await chat(REQUESTED);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("model_not_found");
    expect(body.error.type).toBe("invalid_request_error");
    expect(body.error.message).toContain(`Model '${REQUESTED}' not found in catalog`);
    expect(body.error.message).not.toContain("No active credentials");
    expect(body.error.message).toContain("/v1/models");

    // Error path only: nothing was cooled down or marked unavailable.
    expect(mocks.updateProviderConnection).not.toHaveBeenCalled();
  });

  it("a REAL catalog id on a zero-connection install keeps the legacy credential wording (no regression)", async () => {
    const realId = "anthropic/claude-sonnet-4-20250514";
    const response = await chat(realId);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.message).toContain("No active credentials for provider: anthropic");
    expect(body.error.message).not.toContain("not found in catalog");
  });

  it("a connection EXISTS for the provider → the request leaves the no-credentials branch", async () => {
    // With a real connection, getProviderCredentials returns it and the request
    // proceeds past the 404 branch entirely (the bogus fixture connection fails
    // at the upstream hop — exactly why this test asserts the NEGATIVE: the
    // response is NOT the no-credentials/not-in-catalog 404). The guard the
    // fix must not break is "a connection present ⇒ never the catalog-miss
    // message", whatever the downstream answer is.
    fx.connections = [{ id: "conn-anthropic", provider: "anthropic", isActive: true }];

    const response = await chat(REQUESTED);
    const body = await response.json();

    expect(response.status).not.toBe(404);
    expect(JSON.stringify(body)).not.toContain("not found in catalog");
    expect(JSON.stringify(body)).not.toContain("No active credentials");
  });

  it("an openai-compatible NODE prefix keeps the legacy wording (its catalog is upstream's)", async () => {
    fx.connections = [];
    mocks.getProviderNodes.mockResolvedValue([
      { id: "openai-compatible-chat-3f6c1d2e-1111-4222-8333-444455556666", prefix: "upnode", type: "openai-compatible" },
    ]);

    const response = await chat("upnode/whatever-model");
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.message).toContain("No active credentials for provider: openai-compatible-chat-3f6c1d2e-1111-4222-8333-444455556666");
  });

  it("a passthrough noAuth provider (mmf) never reaches the 404 branch at all (noAuth ⇒ virtual connection)", async () => {
    // noAuth providers get a VIRTUAL connection from auth.js, so
    // getProviderCredentials never returns null and the no-credentials 404
    // branch (where the new message lives) cannot fire — the request goes
    // upstream (mmf's real endpoint rejects the unknown id with 400). The
    // invariant my change must hold: such a response is NOT the new
    // catalog-miss message, and no false "not found in catalog" is invented.
    const response = await chat(`${PASSTHROUGH_ALIAS}/any-model-name`);

    expect(response.status).not.toBe(404);
    const body = await response.json();
    expect(JSON.stringify(body)).not.toContain("not found in catalog");
  });

  it("a CUSTOM model on the provider keeps the legacy wording even with no connection", async () => {
    mocks.getCustomModels.mockResolvedValue([
      { id: "claude-nonexistent-model-56", providerAlias: "anthropic", type: "llm" },
    ]);

    const response = await chat(REQUESTED);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.message).toContain("No active credentials for provider: anthropic");
  });

  it("a failed catalog read degrades to the legacy wording (error path never invents a miss)", async () => {
    // Reject ONLY the helper's filter shape ({provider}); auth.js's own
    // {provider, isActive:true} read must still answer (empty = no connection),
    // so the request reaches the 404 branch and the helper's read fails there.
    mocks.getProviderConnections.mockImplementation(async (filter = {}) => {
      if (filter && !("isActive" in filter)) throw new Error("db unavailable");
      return [];
    });

    const response = await chat(REQUESTED);
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.message).toContain("No active credentials");
  });

  it("message builder is budgeted and carries the id verbatim", () => {
    const longId = "anthropic/" + "x".repeat(120);
    const message = modelNotInCatalogMessage(longId);
    expect(message).toContain(longId);
    expect(message.length).toBeLessThan(250);
    expect(modelNotInCatalogMessage("foo/bar")).toBe(
      "Model 'foo/bar' not found in catalog. See /v1/models for models usable without credentials."
    );
  });
});
