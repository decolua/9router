import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handleImageGenerationCore: vi.fn(),
  markAccountUnavailable: vi.fn(),
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: async () => ({
    accessToken: "provider-token",
    connectionId: "connection-a",
    connectionName: "Codex A",
  }),
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: vi.fn(),
  extractApiKey: () => "client-key",
  isValidApiKey: vi.fn(),
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ requireApiKey: false }),
}));

vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: async () => ({ provider: "codex", model: "gpt-image-2.6-flare" }),
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

const generate = () => handleImageGeneration(new Request("http://localhost/v1/images/generations", {
  method: "POST",
  body: JSON.stringify({ model: "cx/gpt-image-2.6-flare", prompt: "draw a cat" }),
}));

describe("image generation account cooldown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.markAccountUnavailable.mockResolvedValue({ shouldFallback: false, cooldownMs: 0 });
  });

  it("passes the provider-reported reset time to the account lock", async () => {
    const resetsAtMs = Date.now() + 15 * 3600 * 1000;
    mocks.handleImageGenerationCore.mockResolvedValue({
      success: false,
      status: 429,
      error: "[429]: The usage limit has been reached",
      resetsAtMs,
      response: Response.json({ error: "limit" }, { status: 429 }),
    });

    const response = await generate();

    expect(response.status).toBe(429);
    expect(mocks.markAccountUnavailable).toHaveBeenCalledExactlyOnceWith(
      "connection-a", 429, "[429]: The usage limit has been reached", "codex", "gpt-image-2.6-flare", resetsAtMs,
    );
  });

  it("keeps backoff behaviour when no reset time is known", async () => {
    mocks.handleImageGenerationCore.mockResolvedValue({
      success: false,
      status: 500,
      error: "[500]: upstream error",
      response: Response.json({ error: "upstream" }, { status: 500 }),
    });

    await generate();

    expect(mocks.markAccountUnavailable).toHaveBeenCalledExactlyOnceWith(
      "connection-a", 500, "[500]: upstream error", "codex", "gpt-image-2.6-flare", undefined,
    );
  });
});
