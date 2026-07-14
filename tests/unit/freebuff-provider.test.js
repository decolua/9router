import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { PROVIDERS } from "../../open-sse/config/providers.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { hasSpecializedExecutor, getExecutor } from "../../open-sse/executors/index.js";
import { resolveProviderAlias } from "../../open-sse/services/model.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

describe("Freebuff provider registration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers provider config, fb alias, models, and specialized executor", () => {
    expect(PROVIDERS.freebuff.baseUrl).toBe("https://www.codebuff.com/api/v1/chat/completions");
    expect(PROVIDERS.freebuff.format).toBe("openai");
    expect(PROVIDER_MODELS.fb.map((m) => m.id)).toEqual([
      "deepseek/deepseek-v4-pro",
      "moonshotai/kimi-k2.6",
      "deepseek/deepseek-v4-flash",
      "minimax/minimax-m2.7",
    ]);
    expect(resolveProviderAlias("fb")).toBe("freebuff");
    expect(hasSpecializedExecutor("freebuff")).toBe(true);
    expect(hasSpecializedExecutor("fb")).toBe(true);
    expect(getExecutor("freebuff").provider).toBe("freebuff");
  });

  it("returns 503 with Retry-After when the Freebuff waiting room is queued", async () => {
    proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "queued",
        position: 2,
        queueDepth: 5,
        estimatedWaitMs: 9000,
      }),
    });

    const executor = getExecutor("freebuff");
    const result = await executor.execute({
      model: "deepseek/deepseek-v4-pro",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials: { accessToken: "fb-token" },
      log: { warn: vi.fn(), info: vi.fn() },
    });

    expect(result.response.status).toBe(503);
    expect(result.response.headers.get("Retry-After")).toBe("9");
    await expect(result.response.text()).resolves.toContain("waiting_room_queued");
  });

  it("throws when the Freebuff session response is active but missing instanceId", async () => {
    proxyAwareFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: "active" }),
    });

    const executor = getExecutor("freebuff");
    await expect(executor.execute({
      model: "deepseek/deepseek-v4-pro",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials: { accessToken: "fb-token-missing-instance" },
    })).rejects.toThrow("missing instanceId");
  });

  it("throws when starting an agent run fails", async () => {
    proxyAwareFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: "active", instanceId: "instance-1", expiresAt: new Date(Date.now() + 120_000).toISOString() }),
      })
      .mockResolvedValueOnce({
        ok: false,
        text: async () => "run denied",
      });

    const executor = getExecutor("freebuff");
    await expect(executor.execute({
      model: "deepseek/deepseek-v4-pro",
      body: { messages: [{ role: "user", content: "hi" }] },
      stream: true,
      credentials: { accessToken: "fb-token-run-fail" },
    })).rejects.toThrow("run denied");
  });
});
