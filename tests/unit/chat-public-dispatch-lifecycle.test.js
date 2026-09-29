import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getModelInfo: vi.fn(),
  getComboModels: vi.fn(),
  getProviderCredentials: vi.fn(),
  getApiKeyMetadata: vi.fn(),
  getDailyUsageForApiKey: vi.fn(),
  touchApiKey: vi.fn(),
  clearAccountError: vi.fn(async () => {}),
  executor: { execute: vi.fn(), parseError: vi.fn(), noAuth: true },
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
  resolveConnectionProxyConfig: vi.fn(),
  getPxpipeTransform: vi.fn(),
}));

vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  getApiKeyMetadata: mocks.getApiKeyMetadata,
  touchApiKey: mocks.touchApiKey,
}));
vi.mock("@/sse/services/model.js", () => ({ getModelInfo: mocks.getModelInfo, getComboModels: mocks.getComboModels }));
vi.mock("@/sse/services/auth.js", async (importOriginal) => {
  // Real getApiKeyPolicyError/isModelAllowedForKey/checkDailyLimit/isKeyExpired run
  // against the mocked @/lib/localDb + usageRepo above, so S1 dispatch tests exercise
  // the actual policy-evaluation code path handleChat() calls — not a stubbed verdict.
  const actual = await importOriginal();
  return {
    ...actual,
    getProviderCredentials: mocks.getProviderCredentials,
    markAccountUnavailable: vi.fn(async () => ({ shouldFallback: false })),
    clearAccountError: mocks.clearAccountError,
    extractApiKey: vi.fn((request) => request.headers.get("Authorization") ? "key" : null),
    isValidApiKey: vi.fn(),
  };
});
vi.mock("@/sse/services/tokenRefresh.js", () => ({ updateProviderCredentials: vi.fn(), checkAndRefreshToken: mocks.checkAndRefreshToken }));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  getProxyBucketIdentity: () => "direct:test",
}));
vi.mock("@/lib/usageDb.js", () => ({ trackPendingRequest: vi.fn(async () => {}), appendRequestLog: vi.fn(async () => {}), saveRequestDetail: vi.fn(async () => {}), saveRequestUsage: vi.fn(async () => {}) }));
vi.mock("@/lib/db/repos/usageRepo", () => ({ getDailyUsageForApiKey: mocks.getDailyUsageForApiKey }));
vi.mock("@/lib/pxpipe/loader.js", () => ({ getTransform: mocks.getPxpipeTransform }));
vi.mock("@/lib/pxpipe/events.js", () => ({ appendPxpipeEvent: vi.fn() }));
vi.mock("../../open-sse/translator/index.js", () => ({
  translateRequest: vi.fn((_from, _to, _model, body) => ({ ...body })),
  translateResponse: vi.fn((_from, _to, chunk) => [chunk]),
  initState: vi.fn(() => ({})),
  needsTranslation: vi.fn(() => false),
  register: vi.fn(),
}));
vi.mock("../../open-sse/executors/index.js", () => ({ getExecutor: () => mocks.executor }));
vi.mock("../../open-sse/services/combo.js", () => ({ handleComboChat: vi.fn(), handleFusionChat: vi.fn(), detectRequiredCapabilities: vi.fn(() => new Set()) }));
vi.mock("../../open-sse/services/capacityAdapter.js", () => ({ augmentModelsWithCapacityAdapter: vi.fn((models) => models), withCapacityAdapterStripping: vi.fn((handler) => handler), getActiveAdapterStrategy: vi.fn() }));

const { handleChat } = await import("../../src/sse/handlers/chat.js");
const { getAccountSemaphoreSnapshot, resetAccountSemaphores } = await import("../../open-sse/services/accountSemaphore.js");
const { resetCircuitBreaker, recordCircuitOutcome } = await import("../../open-sse/services/circuitBreaker.js");
const { resetProviderFailureTracker } = await import("../../open-sse/services/providerFailureTracker.js");

const encoder = new TextEncoder();
const requestFor = (model = "groq/test", stream = false, options = {}) => new Request("http://router.test/v1/chat/completions", {
  method: "POST", headers: { "content-type": "application/json", ...(options.headers || {}) },
  body: JSON.stringify({ model, stream, messages: options.messages || [{ role: "user", content: "hello" }] }),
});
const credentials = (provider = "groq") => ({ connectionId: `${provider}-connection`, connectionName: provider, provider, accessToken: "test", providerSpecificData: { maxConcurrency: 1 } });
const streamResponse = (chunks, hooks = {}) => new Response(new ReadableStream({
  start(controller) { hooks.start?.(controller); for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); if (!hooks.keepOpen) controller.close(); },
  pull(controller) { hooks.pull?.(controller); },
  cancel(reason) { hooks.cancel?.(reason); },
}), { status: 200, headers: { "content-type": "text/event-stream" } });
const eligibleFreebuffCredentials = () => ({
  ...credentials("freebuff"),
  _connection: { providerSpecificData: { proxyPoolIds: ["pool-a"] } },
  providerSpecificData: { maxConcurrency: 1, proxyPoolId: "pool-a", strictProxy: true, connectionProxyEnabled: true, connectionProxyUrl: "http://pool-a.test" },
});

beforeEach(() => {
  vi.clearAllMocks(); resetAccountSemaphores(); resetCircuitBreaker(); resetProviderFailureTracker();
  mocks.getSettings.mockReset(); mocks.getModelInfo.mockReset(); mocks.getComboModels.mockReset();
  mocks.getProviderCredentials.mockReset(); mocks.getApiKeyMetadata.mockReset(); mocks.getDailyUsageForApiKey.mockReset(); mocks.touchApiKey.mockReset(); mocks.clearAccountError.mockReset(); mocks.executor.execute.mockReset(); mocks.getPxpipeTransform.mockReset();
  mocks.resolveConnectionProxyConfig.mockReset();
  mocks.getSettings.mockResolvedValue({ requireApiKey: false, ccFilterNaming: false, providerThinking: {}, providerStrategies: {} });
  mocks.getComboModels.mockResolvedValue(null);
  mocks.getModelInfo.mockImplementation(async (value) => {
    const [provider, model] = value.split("/"); return { provider, model };
  });
  mocks.getProviderCredentials.mockImplementation(async (provider, _excluded, _model, options = {}) => {
    if (provider !== "freebuff") return credentials(provider);
    const selected = eligibleFreebuffCredentials();
    return options.forceProxyPoolId
      ? { ...selected, providerSpecificData: { ...selected.providerSpecificData, proxyPoolId: options.forceProxyPoolId } }
      : selected;
  });
  mocks.resolveConnectionProxyConfig.mockResolvedValue({});
  mocks.getPxpipeTransform.mockResolvedValue(null);
  mocks.getApiKeyMetadata.mockResolvedValue(null);
  mocks.getDailyUsageForApiKey.mockResolvedValue({ requests: 0, cost: 0 });
  mocks.touchApiKey.mockResolvedValue(undefined);
  mocks.clearAccountError.mockResolvedValue(undefined);
});
afterEach(() => resetAccountSemaphores());

describe("PRD S1–S3 public dispatch lifecycle", () => {
  it("S1-D denies policy before credential selection or upstream dispatch", async () => {
    mocks.getApiKeyMetadata.mockResolvedValue({ allowedModels: ["kr/*"], blockedModels: [], expiresAt: null, maxRequestsPerDay: null, maxSpendUsdPerDay: null });
    const response = await handleChat(new Request("http://router.test/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer key" }, body: JSON.stringify({ model: "opencode-zen/test", messages: [] }) }));
    expect(response.status).toBe(403);
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.executor.execute).not.toHaveBeenCalled();
  });

  it("S1-D real provider-prefix wildcard rejects a different provider's same-named model before dispatch", async () => {
    // A key scoped to "groq/*" must not authorize "groq-compat/test" (prefix
    // collision on the raw string) even though it starts with the same characters —
    // modelPatternMatches enforces a slash-bounded provider segment, not startsWith.
    mocks.getApiKeyMetadata.mockResolvedValue({ allowedModels: ["groq/*"], blockedModels: [], expiresAt: null, maxRequestsPerDay: null, maxSpendUsdPerDay: null });
    mocks.getModelInfo.mockImplementation(async (value) => {
      if (value === "groq-compat/test") return { provider: "groq-compat", model: "test" };
      const [provider, model] = value.split("/");
      return { provider, model };
    });
    const response = await handleChat(new Request("http://router.test/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer key" }, body: JSON.stringify({ model: "groq-compat/test", messages: [] }) }));
    expect(response.status).toBe(403);
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.executor.execute).not.toHaveBeenCalled();
  });

  it("S1-D real provider-prefix wildcard allows a same-provider model through to dispatch", async () => {
    mocks.getApiKeyMetadata.mockResolvedValue({ allowedModels: ["groq/*"], blockedModels: [], expiresAt: null, maxRequestsPerDay: null, maxSpendUsdPerDay: null });
    mocks.executor.execute.mockResolvedValueOnce({ response: new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { headers: { "content-type": "application/json" } }), url: "https://upstream.invalid", headers: {}, transformedBody: {} });
    const response = await handleChat(new Request("http://router.test/v1/chat/completions", { method: "POST", headers: { "content-type": "application/json", Authorization: "Bearer key" }, body: JSON.stringify({ model: "groq/test", messages: [{ role: "user", content: "hello" }] }) }));
    expect(response.status).toBe(200);
    expect(mocks.getProviderCredentials).toHaveBeenCalled();
    expect(mocks.executor.execute).toHaveBeenCalled();
  });

  it("S2-B/S3-D normal non-stream success releases without core terminal and handles sync success callback failure", async () => {
    mocks.executor.execute.mockResolvedValueOnce({ response: new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { headers: { "content-type": "application/json" } }), url: "https://upstream.invalid", headers: {}, transformedBody: {} });
    const response = await handleChat(requestFor());
    expect(response.status).toBe(200);
    expect(getAccountSemaphoreSnapshot()).toEqual([]);
  });

  it.each([
    ["normal", "groq/test"],
    ["eligible Freebuff", "freebuff/test"],
  ])("S2-C/D/F %s streaming EOF retains then releases one slot and records one success", async (_kind, model) => {
    mocks.executor.execute.mockResolvedValueOnce({ response: streamResponse(["data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n", "data: [DONE]\n\n"]), url: "https://upstream.invalid", headers: {}, transformedBody: {} });
    const response = await handleChat(requestFor(model, true));
    expect(getAccountSemaphoreSnapshot()).toEqual([expect.objectContaining({ active: 1 })]);
    await response.text();
    await Promise.resolve();
    expect(getAccountSemaphoreSnapshot()).toEqual([]);
    expect(mocks.clearAccountError).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["sync", () => { throw new Error("sync bookkeeping failure"); }],
    ["async", async () => { throw new Error("async bookkeeping failure"); }],
  ])("S2-D streaming %s success bookkeeping rejection preserves EOF response and releases once", async (_kind, clearAccountError) => {
    mocks.clearAccountError.mockImplementationOnce(clearAccountError);
    mocks.executor.execute.mockResolvedValueOnce({ response: streamResponse(["data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n", "data: [DONE]\n\n"]), url: "https://upstream.invalid", headers: {}, transformedBody: {} });
    const response = await handleChat(requestFor("groq/test", true));
    expect(response.status).toBe(200);
    await response.text();
    await Promise.resolve();
    expect(getAccountSemaphoreSnapshot()).toEqual([]);
    expect(mocks.clearAccountError).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["normal", "groq/test"],
    ["eligible Freebuff", "freebuff/test"],
  ])("S2-D/F S3-F %s reader cancellation releases once and suppresses late success", async (_kind, model) => {
    mocks.executor.execute.mockResolvedValueOnce({
      response: streamResponse(["data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n"], {
        keepOpen: true,
      }),
      url: "https://upstream.invalid", headers: {}, transformedBody: {},
    });

    const response = await handleChat(requestFor(model, true));
    expect(getAccountSemaphoreSnapshot()).toEqual([expect.objectContaining({ active: 1 })]);
    await response.body.cancel("client cancelled");
    await Promise.resolve();
    expect(getAccountSemaphoreSnapshot()).toEqual([]);
    expect(mocks.clearAccountError).not.toHaveBeenCalled();
  });

  it.each([
    ["normal", "groq/test"],
    ["eligible Freebuff", "freebuff/test"],
  ])("S2-D/F S3-F %s upstream read error releases once and suppresses late success", async (_kind, model) => {
    let upstreamController;
    mocks.executor.execute.mockResolvedValueOnce({
      response: streamResponse([], { keepOpen: true, start: (controller) => { upstreamController = controller; } }),
      url: "https://upstream.invalid", headers: {}, transformedBody: {},
    });

    const response = await handleChat(requestFor(model, true));
    expect(getAccountSemaphoreSnapshot()).toEqual([expect.objectContaining({ active: 1 })]);
    const reader = response.body.getReader();
    const pendingRead = reader.read();
    upstreamController.error(new Error("upstream read failed"));
    const terminal = await pendingRead;
    expect(terminal.done).toBe(false);
    await expect(reader.read()).resolves.toMatchObject({ done: true });
    await Promise.resolve();
    expect(getAccountSemaphoreSnapshot()).toEqual([]);
    expect(mocks.clearAccountError).not.toHaveBeenCalled();
  });

  it.each([
    ["normal", "groq/test"],
    ["eligible Freebuff", "freebuff/test"],
  ])("S2-F %s late client disconnect after STREAM_COMPLETED does not overwrite the first outcome", async (_kind, model) => {
    // A real EOF settles STREAM_COMPLETED and releases the slot synchronously; a
    // disconnect callback firing afterward (e.g. socket teardown racing the last
    // read) must be a no-op, not a second competing terminal/outcome record.
    mocks.executor.execute.mockResolvedValueOnce({
      response: streamResponse(["data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n", "data: [DONE]\n\n"]),
      url: "https://upstream.invalid", headers: {}, transformedBody: {},
    });
    const response = await handleChat(requestFor(model, true));
    const reader = response.body.getReader();
    while (!(await reader.read()).done) { /* drain to EOF */ }
    await Promise.resolve();
    expect(getAccountSemaphoreSnapshot()).toEqual([]);
    expect(mocks.clearAccountError).toHaveBeenCalledTimes(1);
    // Late "disconnect" after EOF: cancelling via the same reader that already
    // drained to EOF must not throw, double-release, or fire success again.
    await expect(reader.cancel("late disconnect after EOF")).resolves.toBeUndefined();
    await Promise.resolve();
    expect(getAccountSemaphoreSnapshot()).toEqual([]);
    expect(mocks.clearAccountError).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["normal", "groq/test"],
    ["eligible Freebuff", "freebuff/test"],
  ])("S2-E %s abandoning the response before any read cancels the partial upstream pipe", async (_kind, model) => {
    // Client never reads the body at all (e.g. handler returns but caller drops
    // the Response) — the underlying upstream stream must still be cancelled
    // rather than left dangling, and the slot must still release.
    const upstreamCancel = vi.fn();
    mocks.executor.execute.mockResolvedValueOnce({
      response: streamResponse(["data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n"], {
        keepOpen: true,
        cancel: upstreamCancel,
      }),
      url: "https://upstream.invalid", headers: {}, transformedBody: {},
    });
    const response = await handleChat(requestFor(model, true));
    expect(getAccountSemaphoreSnapshot()).toEqual([expect.objectContaining({ active: 1 })]);
    // Abandon without reading — cancel the client-visible body directly, as a
    // disconnected client's transport would.
    await response.body.cancel("abandoned before handoff read");
    await Promise.resolve();
    expect(getAccountSemaphoreSnapshot()).toEqual([]);
    expect(mocks.clearAccountError).not.toHaveBeenCalled();
  });

  it("S1/S2 an open circuit for the only account skips dispatch and returns unavailable without acquiring a slot", async () => {
    // A provider/bucket already tripped OPEN must short-circuit handleChat's
    // account loop before acquireAccountSlot is ever called for that account,
    // proving the circuit-gate check in chat.js actually gates real dispatch —
    // not just the circuitBreaker unit in isolation (see circuit-breaker.test.js).
    // Real getProviderCredentials returns null once exclusions cover every
    // account; the default test-suite mock ignores exclusions, so it must be
    // overridden here to reach the real "no more accounts" terminal (503)
    // instead of looping the single excluded connection forever.
    const bucket = "direct:test";
    for (let i = 0; i < 10; i++) {
      recordCircuitOutcome({ provider: "groq", bucket, outcome: "DISPATCH_FAILED", status: 503, origin: "upstream_http", connectionId: `seed-${i}`, now: Date.now() + i });
    }
    mocks.getProviderCredentials.mockImplementation(async (_provider, excluded) => (
      excluded.size > 0 ? null : credentials("groq")
    ));
    const response = await handleChat(requestFor("groq/test", false));
    expect(response.status).toBe(503);
    expect(mocks.executor.execute).not.toHaveBeenCalled();
    expect(getAccountSemaphoreSnapshot()).toEqual([]);
  });

  it.each([
    ["normal", "groq/test"],
    ["eligible Freebuff", "freebuff/test"],
  ])("S2-A %s post-acquire settings failure releases once", async (_kind, model) => {
    mocks.getSettings.mockResolvedValueOnce({ requireApiKey: false, ccFilterNaming: false, providerThinking: {}, providerStrategies: {} }).mockRejectedValueOnce(new Error("settings unavailable"));
    const response = await handleChat(requestFor(model));
    expect(response.status).toBe(502);
    expect(getAccountSemaphoreSnapshot()).toEqual([]);
    expect(mocks.executor.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["normal", "groq/test"],
    ["eligible Freebuff", "freebuff/test"],
  ])("S2-A %s post-acquire PXPIPE setup failure releases once", async (_kind, model) => {
    mocks.getSettings.mockResolvedValueOnce({ requireApiKey: false, ccFilterNaming: false, providerThinking: {}, providerStrategies: {}, pxpipeEnabled: true });
    mocks.getSettings.mockResolvedValueOnce({ requireApiKey: false, ccFilterNaming: false, providerThinking: {}, providerStrategies: {}, pxpipeEnabled: true });
    mocks.getPxpipeTransform.mockRejectedValueOnce(new Error("pxpipe unavailable"));
    const response = await handleChat(requestFor(model));
    expect(response.status).toBe(502);
    expect(getAccountSemaphoreSnapshot()).toEqual([]);
    expect(mocks.executor.execute).not.toHaveBeenCalled();
  });

  it.each([
    ["normal", "groq/test"],
    ["eligible Freebuff", "freebuff/test"],
  ])("S2-A %s post-acquire core setup failure releases once", async (_kind, model) => {
    mocks.executor.execute.mockRejectedValueOnce(new Error("core setup failed"));
    const response = await handleChat(requestFor(model));
    expect(response.status).toBe(502);
    expect(getAccountSemaphoreSnapshot()).toEqual([]);
  });

  it("S1-D real public policy denial for opencode-zen occurs before credential selection", async () => {
    mocks.getApiKeyMetadata.mockResolvedValue({ allowedModels: ["groq/*"], blockedModels: [], expiresAt: null, maxRequestsPerDay: null, maxSpendUsdPerDay: null });
    const response = await handleChat(requestFor("opencode-zen/model", false, { headers: { Authorization: "Bearer policy-key" } }));
    expect(response.status).toBe(403);
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.executor.execute).not.toHaveBeenCalled();
  });

  it("S2-B public bypass success does not select credentials, dispatch, or allocate a slot", async () => {
    const response = await handleChat(requestFor("groq/test", true, {
      headers: { "user-agent": "claude-cli" },
      messages: [{ role: "user", content: "Warmup" }],
    }));
    expect(response.status).toBe(200);
    expect(getAccountSemaphoreSnapshot()).toEqual([]);
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
    expect(mocks.executor.execute).not.toHaveBeenCalled();
  });

  it("S2-A normal settings failure after acquire returns 502 and releases once", async () => {
    mocks.getSettings.mockResolvedValueOnce({ requireApiKey: false, ccFilterNaming: false, providerThinking: {}, providerStrategies: {} }).mockRejectedValueOnce(new Error("settings unavailable"));
    const response = await handleChat(requestFor());
    expect(response.status).toBe(502);
    expect(getAccountSemaphoreSnapshot()).toEqual([]);
    expect(mocks.executor.execute).not.toHaveBeenCalled();
  });

  it("S2-A/S2-B Freebuff returned failure releases its acquired slot", async () => {
    mocks.executor.execute.mockResolvedValueOnce({ response: new Response(JSON.stringify({ error: { message: "failed" } }), { status: 503, headers: { "content-type": "application/json" } }), url: "https://upstream.invalid", headers: {}, transformedBody: {} });
    const response = await handleChat(requestFor("freebuff/test"));
    expect(response.status).toBe(503);
    expect(getAccountSemaphoreSnapshot()).toEqual([]);
  });
});
