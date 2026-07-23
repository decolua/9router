import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccountAdmissionError } from "../../src/sse/services/accountAdmission.js";
import { createErrorResult } from "../../open-sse/utils/error.js";

const authMocks = vi.hoisted(() => ({
  acquireProviderCredentials: vi.fn(),
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
  getModelInfo: vi.fn(async () => ({ provider: "codex", model: "gpt-5.6-sol" })),
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
    body: JSON.stringify({ model: "cx/gpt-5.6-sol", input: "Reply only OK" }),
  });
}

function acquisition(id) {
  return {
    credentials: {
      connectionId: id,
      connectionName: id,
      accessToken: `token-${id}`,
    },
    lease: { release: vi.fn(() => true) },
  };
}

describe("chat account admission lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("holds a successful lease until the response body reaches EOF", async () => {
    const selected = acquisition("account-a");
    authMocks.acquireProviderCredentials.mockResolvedValue(selected);
    chatCoreMock.mockResolvedValue({
      success: true,
      response: new Response("ok", { status: 200 }),
    });

    const response = await handleChat(request());

    expect(response.status).toBe(200);
    expect(selected.lease.release).not.toHaveBeenCalled();
    await expect(response.text()).resolves.toBe("ok");
    expect(selected.lease.release).toHaveBeenCalledTimes(1);
  });

  it("releases a failed attempt before marking and selecting fallback", async () => {
    const first = acquisition("account-a");
    const second = acquisition("account-b");
    authMocks.acquireProviderCredentials
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    authMocks.markAccountUnavailable.mockResolvedValue({
      shouldFallback: true,
      cooldownMs: 1000,
    });
    chatCoreMock
      .mockResolvedValueOnce(createErrorResult(429, "usage_limit_reached", undefined, "account"))
      .mockResolvedValueOnce({
        success: true,
        response: new Response("fallback-ok", { status: 200 }),
      });

    const response = await handleChat(request());

    expect(first.lease.release).toHaveBeenCalledTimes(1);
    expect(first.lease.release.mock.invocationCallOrder[0])
      .toBeLessThan(authMocks.markAccountUnavailable.mock.invocationCallOrder[0]);
    expect(second.lease.release).not.toHaveBeenCalled();
    await expect(response.text()).resolves.toBe("fallback-ok");
    expect(second.lease.release).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["queue_full", 3000, "3"],
    ["queue_timeout", 1500, "2"],
  ])("returns local 429 for %s without marking an account", async (reason, retryAfterMs, retryAfter) => {
    authMocks.acquireProviderCredentials.mockRejectedValue(
      new AccountAdmissionError(reason, reason, { retryAfterMs }),
    );

    const response = await handleChat(request());
    const body = await response.json();

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe(retryAfter);
    expect(body).toEqual({
      error: {
        message: reason === "queue_timeout"
          ? "Timed out waiting for local provider capacity"
          : "Local provider admission queue is full",
        type: "rate_limit_error",
        code: "local_admission_limit",
      },
    });
    expect(authMocks.markAccountUnavailable).not.toHaveBeenCalled();
    expect(chatCoreMock).not.toHaveBeenCalled();
  });

  it("returns cancellation without marking an account", async () => {
    authMocks.acquireProviderCredentials.mockRejectedValue(
      new AccountAdmissionError("request_aborted", "aborted"),
    );

    const response = await handleChat(request());

    expect(response.status).toBe(499);
    expect(authMocks.markAccountUnavailable).not.toHaveBeenCalled();
    expect(chatCoreMock).not.toHaveBeenCalled();
  });

  it("releases the lease when the downstream body is cancelled", async () => {
    const selected = acquisition("account-a");
    authMocks.acquireProviderCredentials.mockResolvedValue(selected);
    chatCoreMock.mockResolvedValue({
      success: true,
      response: new Response(new ReadableStream({
        pull(controller) {
          controller.enqueue(new TextEncoder().encode("chunk"));
        },
      })),
    });

    const response = await handleChat(request());
    const reader = response.body.getReader();
    await reader.read();
    await reader.cancel("client_closed");

    expect(selected.lease.release).toHaveBeenCalledTimes(1);
  });
});
