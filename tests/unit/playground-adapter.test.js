import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  dashboardContext: Symbol("dashboard-authorized-context"),
  handleChat: vi.fn(),
  getSettings: vi.fn(),
  getModelInfo: vi.fn(),
  getComboModels: vi.fn(),
  handleChatCore: vi.fn(),
  getProviderCredentials: vi.fn(),
  checkAndRefreshToken: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
  getProxyBucketIdentity: vi.fn(),
  acquireAccountSlot: vi.fn(),
  evaluateCircuit: vi.fn(),
  routeFiniteFreebuff: vi.fn(),
}));

vi.mock("@/sse/handlers/chat.js", () => ({
  DASHBOARD_AUTHORIZED_CONTEXT: mocks.dashboardContext,
  handleChat: mocks.handleChat,
}));
vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));
vi.mock("@/sse/services/model.js", () => ({ getModelInfo: mocks.getModelInfo, getComboModels: mocks.getComboModels }));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));
vi.mock("@/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(() => null),
  isValidApiKey: vi.fn(),
  getApiKeyPolicyError: vi.fn(),
}));
vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: mocks.resolveConnectionProxyConfig,
  getProxyBucketIdentity: mocks.getProxyBucketIdentity,
}));
vi.mock("open-sse/services/accountSemaphore.js", () => ({ acquireAccountSlot: mocks.acquireAccountSlot }));
vi.mock("open-sse/services/circuitBreaker.js", () => ({ evaluateCircuit: mocks.evaluateCircuit, recordCircuitOutcome: vi.fn() }));
vi.mock("@/sse/handlers/freebuffRouting.js", () => ({ routeFiniteFreebuff: mocks.routeFiniteFreebuff }));
vi.mock("open-sse/services/combo.js", () => ({
  handleComboChat: vi.fn(),
  handleFusionChat: vi.fn(),
  detectRequiredCapabilities: vi.fn(() => new Set()),
}));
vi.mock("open-sse/services/capacityAdapter.js", () => ({
  augmentModelsWithCapacityAdapter: vi.fn((models) => models),
  withCapacityAdapterStripping: vi.fn((handler) => handler),
  getActiveAdapterStrategy: vi.fn(),
}));
vi.mock("open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: vi.fn(() => null) }));
vi.mock("@/lib/pxpipe/loader.js", () => ({ getTransform: vi.fn() }));
vi.mock("@/lib/pxpipe/events.js", () => ({ appendPxpipeEvent: vi.fn() }));
vi.mock("@/sse/services/tokenRefresh.js", () => ({ updateProviderCredentials: vi.fn(), checkAndRefreshToken: mocks.checkAndRefreshToken }));
vi.mock("open-sse/services/projectId.js", () => ({ getProjectIdForConnection: vi.fn() }));

const route = await import("../../src/app/api/dashboard/chat/completions/route.js");

function openAiRequest(pathname = "/api/dashboard/chat/completions") {
  return new Request(`http://router.test${pathname}`, {
    method: "POST",
    body: JSON.stringify({
      model: "openai/gpt-test",
      max_tokens: 1,
      messages: [{ role: "user", content: "hello" }],
    }),
    headers: { "content-type": "application/json" },
  });
}

describe("dashboard playground chat adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: true });
    mocks.getComboModels.mockResolvedValue(null);
    mocks.getModelInfo.mockResolvedValue({ provider: "openai", model: "gpt-test" });
    mocks.getProviderCredentials.mockResolvedValue({ connectionId: "connection", providerSpecificData: {} });
    mocks.checkAndRefreshToken.mockImplementation(async (credentials) => credentials);
    mocks.resolveConnectionProxyConfig.mockResolvedValue({});
    mocks.getProxyBucketIdentity.mockReturnValue("direct:test");
    mocks.evaluateCircuit.mockReturnValue({ allowed: true });
    mocks.acquireAccountSlot.mockResolvedValue(vi.fn());
    mocks.handleChatCore.mockResolvedValue({ success: true, response: new Response("ok") });
  });

  it("passes the original request, trusted context, and streaming response through unchanged", async () => {
    const controller = new AbortController();
    const payload = { model: "provider/model", messages: [{ role: "user", content: "hello" }] };
    const request = new Request("http://router.test/api/dashboard/chat/completions", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
      signal: controller.signal,
    });
    const response = new Response(new ReadableStream({
      start(streamController) {
        streamController.enqueue(new TextEncoder().encode("data: hello\n\n"));
        streamController.close();
      },
    }), {
      status: 201,
      headers: { "content-type": "text/event-stream", "x-route-contract": "preserved" },
    });
    mocks.handleChat.mockResolvedValue(response);

    const result = await route.POST(request);
    const [receivedRequest, clientRawRequest, requestContext] = mocks.handleChat.mock.calls[0];

    expect(result).toBe(response);
    expect(receivedRequest).toBe(request);
    expect(clientRawRequest).toBeNull();
    expect(requestContext).toBe(mocks.dashboardContext);
    controller.abort();
    expect(receivedRequest.signal.aborted).toBe(true);
    await expect(receivedRequest.json()).resolves.toEqual(payload);
    await expect(result.text()).resolves.toBe("data: hello\n\n");
  });

  it("exports only POST so Next returns 405 for unsupported methods", () => {
    expect(route.GET).toBeUndefined();
    expect(route.PUT).toBeUndefined();
    expect(route.OPTIONS).toBeUndefined();
  });

  it.each([
    ["body", "", { dashboardAuthorized: true }],
    ["header", "", {}],
    ["query", "?dashboardAuthorized=true", {}],
  ])("does not derive trusted context from forged %s fields", async (source, query, body) => {
    mocks.handleChat.mockResolvedValue(new Response(source));
    const headers = { "content-type": "application/json" };
    if (source === "header") headers["x-dashboard-authorized"] = "true";

    const request = new Request(`http://router.test/api/dashboard/chat/completions${query}`, {
      method: "POST",
      body: JSON.stringify({ model: "provider/model", messages: [], ...body }),
      headers,
    });

    await route.POST(request);

    expect(mocks.handleChat).toHaveBeenCalledWith(request, null, mocks.dashboardContext);
  });

  it("forces OpenAI format for dashboard requests whose body heuristics resemble Claude", async () => {
    const { DASHBOARD_AUTHORIZED_CONTEXT, handleChat } = await vi.importActual("../../src/sse/handlers/chat.js");

    await handleChat(openAiRequest(), null, DASHBOARD_AUTHORIZED_CONTEXT);

    expect(mocks.handleChatCore).toHaveBeenCalledWith(expect.objectContaining({ sourceFormatOverride: "openai", ensureOpenAIDone: true }));
  });

  it.each([
    ["body", "", { ensureOpenAIDone: true }],
    ["header", "", {}],
    ["query", "?ensureOpenAIDone=true", {}],
  ])("does not derive terminal completion from forged %s fields", async (source, query, body) => {
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    const headers = { "content-type": "application/json" };
    if (source === "header") headers["x-ensure-openai-done"] = "true";
    const request = new Request(`http://router.test/v1/chat/completions${query}`, {
      method: "POST",
      body: JSON.stringify({ model: "openai/gpt-test", messages: [], ...body }),
      headers,
    });
    const { handleChat } = await vi.importActual("../../src/sse/handlers/chat.js");

    await handleChat(request);

    expect(mocks.handleChatCore).toHaveBeenCalledWith(expect.objectContaining({ ensureOpenAIDone: false }));
  });

  it("preserves the dashboard OpenAI format override for nested Freebuff dispatch", async () => {
    mocks.getModelInfo.mockResolvedValue({ provider: "freebuff", model: "gpt-test" });
    mocks.routeFiniteFreebuff.mockImplementation(async ({ dispatch }) => ({ response: await dispatch({ connectionId: "connection", providerSpecificData: {} }) }));
    const { DASHBOARD_AUTHORIZED_CONTEXT, handleChat } = await vi.importActual("../../src/sse/handlers/chat.js");

    await handleChat(openAiRequest(), null, DASHBOARD_AUTHORIZED_CONTEXT);

    expect(mocks.handleChatCore).toHaveBeenCalledWith(expect.objectContaining({ sourceFormatOverride: "openai", ensureOpenAIDone: true }));
  });
});
