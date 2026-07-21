import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodexExecutor, classifyCodexFallbackScope } from "../../open-sse/executors/codex.js";
import { createErrorResult, parseUpstreamError } from "../../open-sse/utils/error.js";

const authMocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(() => null),
  isValidApiKey: vi.fn(async () => true),
}));
const chatCoreMock = vi.hoisted(() => vi.fn());
const loggerMocks = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  maskKey: vi.fn(() => "masked"),
}));

vi.mock("open-sse/index.js", () => ({}));
vi.mock("@/sse/services/auth.js", () => authMocks);
vi.mock("@/sse/services/model.js", () => ({
  getModelInfo: vi.fn(async () => ({ provider: "codex", model: "gpt-5.6-sol-pro" })),
  getComboModels: vi.fn(async () => null),
}));
vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: chatCoreMock }));
vi.mock("@/lib/localDb", () => ({ getSettings: vi.fn(async () => ({ requireApiKey: false })) }));
vi.mock("open-sse/utils/claudeHeaderCache.js", () => ({ cacheClaudeHeaders: vi.fn() }));
vi.mock("@/lib/headroom/detect", () => ({ DEFAULT_HEADROOM_URL: "http://127.0.0.1:8787" }));
vi.mock("@/lib/pxpipe/loader.js", () => ({ getTransform: vi.fn(async () => null) }));
vi.mock("@/lib/pxpipe/events.js", () => ({ appendPxpipeEvent: vi.fn() }));
vi.mock("open-sse/services/combo.js", () => ({ handleComboChat: vi.fn(), handleFusionChat: vi.fn() }));
vi.mock("open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: vi.fn(() => null) }));
vi.mock("@/sse/utils/logger.js", () => loggerMocks);
vi.mock("@/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(async () => {}),
  checkAndRefreshToken: vi.fn(async (_provider, credentials) => credentials),
}));
vi.mock("open-sse/services/projectId.js", () => ({ getProjectIdForConnection: vi.fn(async () => null) }));

const { handleChat } = await import("../../src/sse/handlers/chat.js");

function request() {
  return new Request("http://127.0.0.1:20128/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "cx/gpt-5.6-sol-pro", input: "Reply only OK" }),
  });
}

function account(id) {
  return { connectionId: id, connectionName: id, accessToken: `token-${id}` };
}

describe("Codex deterministic reasoning fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    [400, "Unsupported reasoning mode pro", "request"],
    [404, "Model not found", "request"],
    [422, "Invalid reasoning effort", "request"],
    [403, "Your plan does not include Pro model access", "request"],
    [401, "token_invalid", "account"],
    [429, "usage_limit_reached", "account"],
    [503, "Selected model is at capacity", "account"],
  ])("classifies status %s as %s scope", (status, message, scope) => {
    expect(classifyCodexFallbackScope(status, message)).toBe(scope);
  });

  it("marks local reasoning validation failures as request-scoped 400s", () => {
    const executor = new CodexExecutor();
    try {
      executor.transformRequest("gpt-5.6-sol", {
        model: "gpt-5.6-sol",
        input: "hi",
        reasoning: { mode: "turbo" },
      }, true, {});
      throw new Error("expected transformRequest to fail");
    } catch (error) {
      expect(error.status).toBe(400);
      expect(error.fallbackScope).toBe("request");
    }
  });

  it("propagates executor fallback scope through the shared error contract", async () => {
    const executor = new CodexExecutor();
    const parsed = await parseUpstreamError(new Response(JSON.stringify({
      error: { message: "Unsupported reasoning effort max" },
    }), { status: 400 }), executor);
    expect(parsed).toMatchObject({ statusCode: 400, fallbackScope: "request" });
    expect(createErrorResult(parsed.statusCode, parsed.message, parsed.resetsAtMs, parsed.fallbackScope))
      .toMatchObject({ success: false, status: 400, fallbackScope: "request" });
  });

  it("returns a request-scoped error without locking or rotating accounts", async () => {
    authMocks.getProviderCredentials.mockResolvedValue(account("conn-1"));
    chatCoreMock.mockResolvedValue(createErrorResult(
      400,
      "Unsupported reasoning mode pro",
      undefined,
      "request",
    ));

    const response = await handleChat(request());

    expect(response.status).toBe(400);
    expect(authMocks.getProviderCredentials).toHaveBeenCalledTimes(1);
    expect(authMocks.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("keeps account fallback for quota errors", async () => {
    authMocks.getProviderCredentials
      .mockResolvedValueOnce(account("conn-1"))
      .mockResolvedValueOnce(account("conn-2"));
    authMocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true, cooldownMs: 1000 });
    chatCoreMock
      .mockResolvedValueOnce(createErrorResult(429, "usage_limit_reached", undefined, "account"))
      .mockResolvedValueOnce({ success: true, response: new Response("ok", { status: 200 }) });

    const response = await handleChat(request());

    expect(response.status).toBe(200);
    expect(authMocks.getProviderCredentials).toHaveBeenCalledTimes(2);
    expect(authMocks.markAccountUnavailable).toHaveBeenCalledWith(
      "conn-1",
      429,
      "usage_limit_reached",
      "codex",
      "gpt-5.6-sol-pro",
      undefined,
      "account",
    );
  });
});
