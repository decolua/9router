import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProviderCredentials: vi.fn(),
  markAccountUnavailable: vi.fn(),
  clearAccountError: vi.fn(),
  extractApiKey: vi.fn(),
  isValidApiKey: vi.fn(),
  getSettings: vi.fn(),
  getModelInfo: vi.fn(),
  getComboModels: vi.fn(),
  handleImageGenerationCore: vi.fn(),
  updateProviderCredentials: vi.fn(),
  checkAndRefreshToken: vi.fn(),
}));

vi.mock("../../src/sse/services/auth.js", () => ({
  getProviderCredentials: mocks.getProviderCredentials,
  markAccountUnavailable: mocks.markAccountUnavailable,
  clearAccountError: mocks.clearAccountError,
  extractApiKey: mocks.extractApiKey,
  isValidApiKey: mocks.isValidApiKey,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
}));

vi.mock("../../src/sse/services/model.js", () => ({
  getModelInfo: mocks.getModelInfo,
  getComboModels: mocks.getComboModels,
}));

vi.mock("open-sse/handlers/imageGenerationCore.js", () => ({
  handleImageGenerationCore: mocks.handleImageGenerationCore,
}));

vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: mocks.updateProviderCredentials,
  checkAndRefreshToken: mocks.checkAndRefreshToken,
}));

const { handleImageGeneration } = await import("../../src/sse/handlers/imageGeneration.js");

describe("image generation account fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSettings.mockResolvedValue({ requireApiKey: false });
    mocks.getComboModels.mockResolvedValue(null);
    mocks.getModelInfo.mockResolvedValue({
      provider: "antigravity",
      model: "gemini-3.1-flash-image",
    });
    mocks.checkAndRefreshToken.mockImplementation(async (_provider, credentials) => credentials);
  });

  it("switches to the next Antigravity account after an exact runtime quota limit", async () => {
    const first = { connectionId: "ag-first", accessToken: "first-token", connectionName: "First" };
    const second = { connectionId: "ag-second", accessToken: "second-token", connectionName: "Second" };
    const resetAtMs = Date.now() + 2 * 60 * 60 * 1000;

    mocks.getProviderCredentials
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    mocks.handleImageGenerationCore
      .mockResolvedValueOnce({
        success: false,
        status: 429,
        error: "RESOURCE_EXHAUSTED: capacity exhausted",
        resetsAtMs: resetAtMs,
      })
      .mockImplementationOnce(async (options) => {
        await options.onRequestSuccess();
        return {
          success: true,
          response: Response.json({ created: 1, data: [{ b64_json: "generated" }] }),
        };
      });
    mocks.markAccountUnavailable.mockResolvedValueOnce({ shouldFallback: true });

    const response = await handleImageGeneration(new Request("http://router.test/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "antigravity/gemini-3.1-flash-image",
        prompt: "Generate a test image",
      }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-connection-id")).toBe("ag-second");
    expect(mocks.handleImageGenerationCore).toHaveBeenCalledTimes(2);
    expect(mocks.handleImageGenerationCore.mock.calls[0][0].credentials).toBe(first);
    expect(mocks.handleImageGenerationCore.mock.calls[1][0].credentials).toBe(second);
    expect(mocks.markAccountUnavailable).toHaveBeenCalledWith(
      "ag-first",
      429,
      expect.stringContaining("RESOURCE_EXHAUSTED"),
      "antigravity",
      "gemini-3.1-flash-image",
      resetAtMs
    );

    const secondSelectionExclusions = mocks.getProviderCredentials.mock.calls[1][1];
    expect(secondSelectionExclusions).toBeInstanceOf(Set);
    expect(secondSelectionExclusions.has("ag-first")).toBe(true);
    expect(mocks.clearAccountError).toHaveBeenCalledWith("ag-second", second, "gemini-3.1-flash-image");
  });

  it("does not lock or rotate accounts for an invalid image payload", async () => {
    const account = { connectionId: "codex-first", accessToken: "token" };
    mocks.getModelInfo.mockResolvedValue({ provider: "codex", model: "gpt-image-2" });
    mocks.getProviderCredentials.mockResolvedValueOnce(account);
    mocks.handleImageGenerationCore.mockResolvedValueOnce({
      success: false,
      status: 400,
      error: "Invalid reference image at images[0]",
      retryable: false,
      response: Response.json({ error: { message: "Invalid reference image at images[0]" } }, { status: 400 }),
    });

    const response = await handleImageGeneration(new Request("http://router.test/v1/images/generations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "codex/gpt-image-2",
        prompt: "A cat",
        images: ["not an image"],
      }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.getProviderCredentials).toHaveBeenCalledTimes(1);
    expect(mocks.markAccountUnavailable).not.toHaveBeenCalled();
  });
});
