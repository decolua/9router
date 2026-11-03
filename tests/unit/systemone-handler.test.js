import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  isValidApiKey: vi.fn(),
  getApiKeyPolicyError: vi.fn(),
  getModelInfo: vi.fn(),
  getProviderCredentials: vi.fn(),
  handleSystemoneCore: vi.fn(),
  saveRequestUsage: vi.fn(),
  checkAndRefreshToken: vi.fn(),
}));

vi.mock("../../src/lib/localDb.js", () => ({ getSettings: mocks.getSettings }));
vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: (request) => request.headers.get("authorization")?.replace(/^Bearer /, "") || null,
  isValidApiKey: mocks.isValidApiKey,
  getApiKeyPolicyError: mocks.getApiKeyPolicyError,
}));
vi.mock("../../src/sse/services/model.js", () => ({ getModelInfo: mocks.getModelInfo }));
vi.mock("open-sse/handlers/systemoneCore.js", () => ({ handleSystemoneCore: mocks.handleSystemoneCore }));
vi.mock("../../src/lib/usageDb.js", () => ({ saveRequestUsage: mocks.saveRequestUsage }));
vi.mock("../../src/sse/services/tokenRefresh.js", () => ({ checkAndRefreshToken: mocks.checkAndRefreshToken }));
vi.mock("open-sse/utils/error.js", () => ({
  errorResponse: (status, message) => Response.json({ error: message }, { status }),
  unavailableResponse: (status, message) => Response.json({ error: message }, { status }),
}));
vi.mock("open-sse/config/runtimeConfig.js", () => ({ HTTP_STATUS: { BAD_REQUEST: 400, UNAUTHORIZED: 401, SERVICE_UNAVAILABLE: 503 } }));
vi.mock("../../src/sse/utils/logger.js", () => ({ request: vi.fn(), debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn(), maskKey: (key) => key }));

import { handleSystemone } from "../../src/sse/handlers/systemone.js";

function request(apiKey = null) {
  return new Request("http://localhost/v1/systemone", {
    method: "POST",
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
    body: JSON.stringify({ model: "provider/model", state: {}, questions: {} }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({ requireApiKey: false });
  mocks.isValidApiKey.mockResolvedValue(true);
  mocks.getApiKeyPolicyError.mockResolvedValue(null);
  mocks.getModelInfo.mockResolvedValue({ provider: "provider", model: "model" });
  mocks.getProviderCredentials.mockResolvedValue({ connectionId: "conn-1", connectionName: "Account" });
  mocks.checkAndRefreshToken.mockResolvedValue({ accessToken: "token" });
  mocks.handleSystemoneCore.mockResolvedValue({ success: true, response: Response.json({ ok: true }) });
  mocks.saveRequestUsage.mockResolvedValue(undefined);
});

describe("System One policy and accounting", () => {
  it.each([
    [401, "expired key"],
    [403, "denied model"],
    [429, "daily limit"],
  ])("rejects a supplied key for %s without an upstream call", async (status) => {
    mocks.getApiKeyPolicyError.mockResolvedValue({ status, message: "blocked" });
    const response = await handleSystemone(request("sk-test"));
    expect(response.status).toBe(status);
    expect(mocks.handleSystemoneCore).not.toHaveBeenCalled();
    expect(mocks.getProviderCredentials).not.toHaveBeenCalled();
  });

  it("applies a supplied key policy when requireApiKey is disabled", async () => {
    mocks.getApiKeyPolicyError.mockResolvedValue({ status: 403, message: "blocked" });
    const response = await handleSystemone(request("sk-test"));
    expect(response.status).toBe(403);
    expect(mocks.getApiKeyPolicyError).toHaveBeenCalledWith("sk-test", "provider/model");
  });

  it("records a successful request even when the upstream omits usage", async () => {
    const response = await handleSystemone(request());
    expect(response.status).toBe(200);
    expect(mocks.saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({
      provider: "provider",
      model: "model",
      tokens: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }));
  });
});
