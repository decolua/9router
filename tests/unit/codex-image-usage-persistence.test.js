import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleImageGenerationCore: vi.fn(),
  saveRequestUsage: vi.fn(),
  clearAccountError: vi.fn(),
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: async () => ({
    accessToken: "provider-token",
    connectionId: "connection-a",
    connectionName: "Codex A",
  }),
  markAccountUnavailable: vi.fn(),
  clearAccountError: mocks.clearAccountError,
  extractApiKey: () => "client-key",
  isValidApiKey: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: false }),
}));

vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: async () => ({ provider: "codex", model: "gpt-5.6-sol-image" }),
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
  saveRequestUsage: mocks.saveRequestUsage,
}));

import { handleImageGeneration } from "../../src/sse/handlers/imageGeneration.js";

describe("Codex image usage persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveRequestUsage.mockResolvedValue(undefined);
    mocks.clearAccountError.mockResolvedValue(undefined);
  });

  it("persists exact provider-reported input/output tokens", async () => {
    mocks.handleImageGenerationCore.mockImplementation(async ({ onUsage, onRequestSuccess }) => {
      await onUsage?.({
        prompt_tokens: 321,
        completion_tokens: 654,
        total_tokens: 975,
        cached_tokens: 111,
        reasoning_tokens: 22,
      });
      await onRequestSuccess?.();
      return { success: true, response: Response.json({ data: [{ b64_json: "image" }] }) };
    });

    await handleImageGeneration(new Request("http://localhost/v1/images/generations", {
      method: "POST",
      headers: { Authorization: "Bearer client-key" },
      body: JSON.stringify({ model: "cx/gpt-5.6-sol-image", prompt: "draw a cat" }),
    }));

    expect(mocks.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(mocks.saveRequestUsage).toHaveBeenCalledWith({
      provider: "codex",
      model: "gpt-5.6-sol-image",
      connectionId: "connection-a",
      apiKey: "client-key",
      endpoint: "/v1/images/generations",
      tokens: {
        prompt_tokens: 321,
        completion_tokens: 654,
        total_tokens: 975,
        cached_tokens: 111,
        reasoning_tokens: 22,
      },
      status: "success",
    });
  });

  it("does not persist fabricated usage when upstream usage is absent", async () => {
    mocks.handleImageGenerationCore.mockImplementation(async ({ onRequestSuccess }) => {
      await onRequestSuccess?.();
      return { success: true, response: Response.json({ data: [{ b64_json: "image" }] }) };
    });

    await handleImageGeneration(new Request("http://localhost/v1/images/generations", {
      method: "POST",
      body: JSON.stringify({ model: "cx/gpt-5.6-sol-image", prompt: "draw a cat" }),
    }));

    expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
  });
});
