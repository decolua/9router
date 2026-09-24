import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  updateProviderCredentials: vi.fn(),
}));
vi.mock("../../open-sse/services/tokenRefresh.js", async (importOriginal) => ({
  ...(await importOriginal()),
  refreshCodexToken: vi.fn(),
}));

import { resolveCodexModels } from "../../src/sse/services/codexModels.js";
import { refreshCodexToken } from "../../open-sse/services/tokenRefresh.js";
import { updateProviderCredentials } from "../../src/sse/services/tokenRefresh.js";

const originalFetch = global.fetch;
const catalog = (models) => ({ ok: true, status: 200, json: async () => ({ models }) });
const connection = (id, account, token = `token-${id}`) => ({
  id,
  provider: "codex",
  accessToken: token,
  refreshToken: `refresh-${id}`,
  providerSpecificData: { chatgptAccountId: account },
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("live Codex models", () => {
  it("normalizes live models, adds review variants, and binds the account header", async () => {
    global.fetch = vi.fn().mockResolvedValue(catalog([
      { slug: "gpt-6-sol", display_name: "GPT 6 Sol", description: "Live" },
      { id: "gpt-image-2", kind: "image" },
    ]));

    const result = await resolveCodexModels(connection("normalize", "account-a"));

    expect(result.models.map((model) => model.id)).toEqual([
      "gpt-6-sol", "gpt-6-sol-review", "gpt-image-2",
    ]);
    expect(result.models[1]).toMatchObject({
      name: "GPT 6 Sol Review",
      upstreamModelId: "gpt-6-sol",
      quotaFamily: "review",
      description: "Live",
    });
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/codex/models?client_version="),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token-normalize",
          "ChatGPT-Account-ID": "account-a",
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("isolates cached catalogs by connection, account, and token, while force refresh bypasses cache", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce(catalog([{ id: "model-a" }]))
      .mockResolvedValueOnce(catalog([{ id: "model-b" }]))
      .mockResolvedValueOnce(catalog([{ id: "model-c" }]))
      .mockResolvedValueOnce(catalog([{ id: "model-d" }]));
    const a = connection("cache-a", "account-a", "shared-token");
    const b = connection("cache-b", "account-b", "shared-token");

    expect((await resolveCodexModels(a)).models[0].id).toBe("model-a");
    expect((await resolveCodexModels(a)).models[0].id).toBe("model-a");
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect((await resolveCodexModels(b)).models[0].id).toBe("model-b");
    a.providerSpecificData.chatgptAccountId = "account-c";
    expect((await resolveCodexModels(a)).models[0].id).toBe("model-c");
    a.accessToken = "rotated-token";
    expect((await resolveCodexModels(a, { forceRefresh: true })).models[0].id).toBe("model-d");
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it("refreshes on authorization failure, persists metadata, and retries with the new token", async () => {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce(catalog([{ id: "gpt-6-luna" }]));
    refreshCodexToken.mockResolvedValue({
      accessToken: "new-access", refreshToken: "new-refresh",
      idToken: "new-id", expiresIn: 3600,
    });
    updateProviderCredentials.mockResolvedValue(true);
    const conn = connection("refresh", "account-r");

    const result = await resolveCodexModels(conn);

    expect(result.models[0].id).toBe("gpt-6-luna");
    expect(refreshCodexToken).toHaveBeenCalledWith("refresh-refresh", null);
    expect(updateProviderCredentials).toHaveBeenCalledWith("refresh", expect.objectContaining({
      accessToken: "new-access", refreshToken: "new-refresh",
      idToken: "new-id", expiresIn: 3600,
    }));
    expect(conn.accessToken).toBe("new-access");
    expect(global.fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer new-access");
  });

  it("returns only a status-safe warning for upstream failures", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 503,
      text: async () => "secret upstream response",
    });

    const result = await resolveCodexModels(connection("failure", "account-f"));

    expect(result).toEqual({ models: [], warning: "Failed to fetch Codex models: HTTP 503", status: 503 });
    expect(JSON.stringify(result)).not.toContain("secret upstream response");
  });
});
