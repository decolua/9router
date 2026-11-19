import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connections: [],
  handleImageGenerationCore: vi.fn(),
  markAccountUnavailable: vi.fn(),
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: async (_provider, excludeConnectionIds) =>
    mocks.connections.find((c) => !excludeConnectionIds.has(c.connectionId)) || null,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: vi.fn(),
  extractApiKey: () => "client-key",
  isValidApiKey: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: false }),
}));

vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: async () => ({ provider: "codex", model: "gpt-image-2" }),
  getComboModels: async () => null,
}));

vi.mock("../../open-sse/handlers/imageGenerationCore.js", () => ({
  handleImageGenerationCore: mocks.handleImageGenerationCore,
}));

vi.mock("../../open-sse/utils/error.js", () => ({
  errorResponse: (status, message) => Response.json({ error: message }, { status }),
  unavailableResponse: (status, message) => Response.json({ error: message }, { status }),
}));

vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
  checkAndRefreshToken: async (_provider, credentials) => credentials,
}));

vi.mock("../../open-sse/services/combo.js", () => ({
  handleComboChat: vi.fn(),
}));

vi.mock("../../src/sse/utils/logger.js", () => ({
  request: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  maskKey: vi.fn(),
}));

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestUsage: vi.fn(),
}));

import { handleImageGeneration } from "../../src/sse/handlers/imageGeneration.js";
import codexImageAdapter from "../../open-sse/handlers/imageProviders/codex.js";

function jwtWithPlan(plan) {
  const payload = { "https://api.openai.com/auth": { chatgpt_account_id: "acct", chatgpt_plan_type: plan } };
  return `e30.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
}

function imageRequest() {
  return new Request("http://localhost/v1/images/generations", {
    method: "POST",
    body: JSON.stringify({ model: "cx/gpt-image-2", prompt: "draw a cat" }),
  });
}

describe("Codex image adapter plan gate", () => {
  it.each(["go", "plus", "pro", "team"])("allows %s accounts", (plan) => {
    expect(codexImageAdapter.canUseCredentials({ accessToken: jwtWithPlan(plan) })).toBe(true);
  });

  it("rejects free accounts", () => {
    expect(codexImageAdapter.canUseCredentials({ accessToken: jwtWithPlan("free") })).toBe(false);
  });

  it("prefers the token claim over a stale stored plan", () => {
    expect(codexImageAdapter.canUseCredentials({
      accessToken: jwtWithPlan("free"),
      providerSpecificData: { chatgptPlanType: "plus" },
    })).toBe(false);
  });

  it("falls back to the id token, then the stored plan", () => {
    expect(codexImageAdapter.canUseCredentials({ accessToken: "opaque", idToken: jwtWithPlan("free") })).toBe(false);
    expect(codexImageAdapter.canUseCredentials({ accessToken: "opaque", providerSpecificData: { chatgptPlanType: "free" } })).toBe(false);
  });

  it("allows accounts with no plan information", () => {
    expect(codexImageAdapter.canUseCredentials({ accessToken: "opaque" })).toBe(true);
  });
});

describe("Codex image account selection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.handleImageGenerationCore.mockResolvedValue({
      success: true,
      response: Response.json({ data: [{ b64_json: "image" }] }),
    });
  });

  it("skips free accounts and generates with the next entitled account", async () => {
    mocks.connections = [
      { connectionId: "free-account-1", accessToken: jwtWithPlan("free") },
      { connectionId: "free-account-2", accessToken: jwtWithPlan("free") },
      { connectionId: "go-account-01", accessToken: jwtWithPlan("go") },
    ];

    const res = await handleImageGeneration(imageRequest());

    expect(res.status).toBe(200);
    expect(mocks.handleImageGenerationCore).toHaveBeenCalledTimes(1);
    expect(mocks.handleImageGenerationCore.mock.calls[0][0].credentials.connectionId).toBe("go-account-01");
    // Free accounts stay usable for chat: they are skipped, not locked.
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });

  it("returns 403 without calling upstream when only free accounts exist", async () => {
    mocks.connections = [{ connectionId: "free-account-1", accessToken: jwtWithPlan("free") }];

    const res = await handleImageGeneration(imageRequest());

    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/ChatGPT Free/);
    expect(mocks.handleImageGenerationCore).not.toHaveBeenCalled();
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });
});
