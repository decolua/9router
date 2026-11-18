import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleImageGenerationCore: vi.fn(),
  saveRequestUsage: vi.fn(),
  clearAccountError: vi.fn(),
  provider: "codex",
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
  getModelInfo: async () => ({ provider: mocks.provider, model: "gpt-6-sol-image" }),
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
    mocks.provider = "codex";
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
      body: JSON.stringify({ model: "cx/gpt-6-sol-image", prompt: "draw a cat" }),
    }));

    expect(mocks.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(mocks.saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({
      provider: "codex",
      model: "gpt-6-sol-image",
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
    }));
  });

  it("persists a zero-token inference without fabricating usage", async () => {
    mocks.handleImageGenerationCore.mockImplementation(async ({ onRequestSuccess }) => {
      await onRequestSuccess?.();
      return { success: true, response: Response.json({ data: [{ b64_json: "image" }] }) };
    });

    await handleImageGeneration(new Request("http://localhost/v1/images/generations", {
      method: "POST",
      body: JSON.stringify({ model: "cx/gpt-6-sol-image", prompt: "draw a cat" }),
    }));

    expect(mocks.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(mocks.saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({
      tokens: {}, status: "success", requestId: expect.any(String),
      timestamp: expect.any(String), latencyMs: expect.any(Number),
    }));
  });

  it("records upstream failures without persisting error payloads", async () => {
    mocks.handleImageGenerationCore.mockResolvedValue({
      success: false, status: 502, error: "secret base64 data", response: new Response("upstream", { status: 502 }),
    });
    mocks.clearAccountError.mockResolvedValue(undefined);
    const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");
    markAccountUnavailable.mockResolvedValue({ shouldFallback: false });
    const response = await handleImageGeneration(new Request("http://localhost/v1/images/generations", {
      method: "POST", body: JSON.stringify({ model: "cx/gpt-6-sol-image", prompt: "draw" }),
    }));
    expect(await response.text()).toBe("upstream");
    expect(mocks.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(mocks.saveRequestUsage.mock.calls[0][0]).toEqual(expect.objectContaining({ tokens: {}, status: "error" }));
    expect(JSON.stringify(mocks.saveRequestUsage.mock.calls)).not.toContain("secret base64 data");
  });

  it("waits for streaming completion and records only once", async () => {
    let complete;
    let reportUsage;
    mocks.handleImageGenerationCore.mockImplementation(async ({ onRequestComplete, onUsage }) => {
      complete = onRequestComplete;
      reportUsage = onUsage;
      return { success: true, usagePending: true, response: new Response("stream") };
    });
    await handleImageGeneration(new Request("http://localhost/v1/images/generations", {
      method: "POST", body: JSON.stringify({ model: "cx/gpt-6-sol-image", prompt: "draw" }),
    }));
    expect(mocks.saveRequestUsage).not.toHaveBeenCalled();
    reportUsage({ prompt_tokens: 3, completion_tokens: 7, secret: "data:image/png;base64,payload" });
    await complete(false);
    await complete(true);
    expect(mocks.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(mocks.saveRequestUsage.mock.calls[0][0]).toEqual(expect.objectContaining({
      tokens: { prompt_tokens: 3, completion_tokens: 7 }, status: "error",
    }));
  });

  it("records no-auth image generation without a connection or invented tokens", async () => {
    mocks.provider = "sdwebui";
    mocks.handleImageGenerationCore.mockResolvedValue({
      success: true, response: Response.json({ data: [{ b64_json: "image" }] }),
    });
    await handleImageGeneration(new Request("http://localhost/v1/images/generations", {
      method: "POST", body: JSON.stringify({ model: "sdwebui/sdxl", prompt: "draw" }),
    }));
    expect(mocks.saveRequestUsage).toHaveBeenCalledTimes(1);
    expect(mocks.saveRequestUsage.mock.calls[0][0]).toEqual(expect.objectContaining({
      provider: "sdwebui", connectionId: undefined, tokens: {}, status: "success",
    }));
  });
});
