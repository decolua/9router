import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ saveRequestUsage: vi.fn() }));

vi.mock("@/lib/usageDb.js", () => ({
  saveRequestUsage: mocks.saveRequestUsage,
  appendRequestLog: vi.fn(),
  saveRequestDetail: vi.fn(),
}));

import { saveUsageStats } from "../../open-sse/handlers/chatCore/requestDetail.js";

describe("API key client usage metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.saveRequestUsage.mockResolvedValue();
  });

  it("passes internal client identity to usage storage", async () => {
    saveUsageStats({
      provider: "codex",
      model: "gpt-test",
      tokens: { prompt_tokens: 10, completion_tokens: 2 },
      apiKey: "sk-test",
      apiKeyClient: {
        apiKeyId: "key-id",
        fingerprint: "client-fingerprint",
      },
      silent: true,
    });
    await Promise.resolve();

    expect(mocks.saveRequestUsage).toHaveBeenCalledWith(expect.objectContaining({
      meta: {
        apiKeyId: "key-id",
        apiKeyClientFingerprint: "client-fingerprint",
      },
    }));
  });
});
