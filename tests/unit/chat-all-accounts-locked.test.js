import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  getModelInfo: vi.fn(),
  getComboModels: vi.fn(),
  handleChatCore: vi.fn(),
  checkAndRefreshToken: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({ getSettings: mocks.getSettings }));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: vi.fn(() => null),
  isValidApiKey: vi.fn(),
}));

vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
  getComboModels: mocks.getComboModels,
}));

vi.mock("open-sse/handlers/chatCore.js", () => ({ handleChatCore: mocks.handleChatCore }));

vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: mocks.checkAndRefreshToken,
  updateProviderCredentials: vi.fn(),
}));

vi.mock("../../src/sse/utils/logger.js", () => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  maskKey: vi.fn(),
}));

const { handleChat } = await import("../../src/sse/handlers/chat.js");

const request = () => new Request("https://router.test/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ model: "kiro/gpt-5.6-sol", messages: [{ role: "user", content: "ping" }] }),
});

describe("chat aggregate account locks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T16:00:00.000Z"));
    mocks.getSettings.mockResolvedValue({ requireApiKey: false, providerStrategies: {} });
    mocks.getComboModels.mockResolvedValue(null);
    mocks.getModelInfo.mockResolvedValue({ provider: "kiro", model: "gpt-5.6-sol" });
    mocks.checkAndRefreshToken.mockImplementation(async (_provider, credentials) => credentials);
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: true, cooldownMs: 120_000 });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the earliest transient lock metadata instead of the last attempted quota error", async () => {
    const retryAfter = new Date(Date.now() + 30_000).toISOString();
    mocks.getProviderCredentials
      .mockResolvedValueOnce({
        connectionId: "quota-account",
        connectionName: "Quota account",
        providerSpecificData: {},
      })
      .mockResolvedValueOnce({
        allRateLimited: true,
        retryAfter,
        retryAfterHuman: "reset after 30s",
        lastError: "Funded account bad gateway",
        lastErrorCode: 502,
      });
    mocks.handleChatCore.mockResolvedValue({
      success: false,
      status: 402,
      error: "MONTHLY_REQUEST_COUNT",
      response: Response.json({ error: { message: "MONTHLY_REQUEST_COUNT" } }, { status: 402 }),
    });

    const response = await handleChat(request());
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(body.error.message).toContain("Funded account bad gateway");
    expect(body.error.message).not.toContain("MONTHLY_REQUEST_COUNT");
  });

  it("does not borrow prior account metadata when the earliest lock owner has none", async () => {
    const retryAfter = new Date(Date.now() + 30_000).toISOString();
    mocks.getProviderCredentials
      .mockResolvedValueOnce({
        connectionId: "quota-account",
        connectionName: "Quota account",
        providerSpecificData: {},
      })
      .mockResolvedValueOnce({
        allRateLimited: true,
        retryAfter,
        retryAfterHuman: "reset after 30s",
        lastError: null,
        lastErrorCode: null,
      });
    mocks.handleChatCore.mockResolvedValue({
      success: false,
      status: 402,
      error: "MONTHLY_REQUEST_COUNT",
      response: Response.json({ error: { message: "MONTHLY_REQUEST_COUNT" } }, { status: 402 }),
    });

    const response = await handleChat(request());
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get("Retry-After")).toBe("30");
    expect(body.error.message).toContain("Unavailable");
    expect(body.error.message).not.toContain("MONTHLY_REQUEST_COUNT");
  });

  it("keeps a genuine aggregate quota exhaustion as 402", async () => {
    const retryAfter = new Date(Date.now() + 120_000).toISOString();
    mocks.getProviderCredentials.mockResolvedValue({
      allRateLimited: true,
      retryAfter,
      retryAfterHuman: "reset after 2m",
      lastError: "MONTHLY_REQUEST_COUNT",
      lastErrorCode: 402,
    });

    const response = await handleChat(request());
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(response.headers.get("Retry-After")).toBe("120");
    expect(body.error.message).toContain("MONTHLY_REQUEST_COUNT");
    expect(mocks.handleChatCore).not.toHaveBeenCalled();
  });
});
