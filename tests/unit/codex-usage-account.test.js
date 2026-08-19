import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  proxyAwareFetch: vi.fn(),
}));

function idTokenFor(accountId) {
  const payload = Buffer.from(JSON.stringify({
    "https://api.openai.com/auth": { chatgpt_account_id: accountId },
  })).toString("base64url");
  return `header.${payload}.signature`;
}

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: mocks.proxyAwareFetch,
}));

describe("Codex usage account binding", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.proxyAwareFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ rate_limit: {}, rate_limit_reset_credits: {} }),
    });
  });

  it("sends ChatGPT-Account-ID from workspaceId first", async () => {
    const { getCodexUsage } = await import("../../open-sse/services/usage/codex.js");
    await getCodexUsage("token", { workspaceId: "team_ws", chatgptAccountId: "free_ws" }, { strictProxy: false });

    expect(mocks.proxyAwareFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ "ChatGPT-Account-ID": "team_ws" }),
      }),
      { strictProxy: false },
    );
  });

  it("falls back to chatgptAccountId when workspaceId is missing", async () => {
    const { getCodexUsage } = await import("../../open-sse/services/usage/codex.js");
    await getCodexUsage("token", { chatgptAccountId: "free_ws" }, null);

    expect(mocks.proxyAwareFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ "ChatGPT-Account-ID": "free_ws" }),
      }),
      null,
    );
  });

  it("skips blank legacy account fields", async () => {
    const { getCodexUsage } = await import("../../open-sse/services/usage/codex.js");
    await getCodexUsage("token", { workspaceId: "  ", chatgptAccountId: "team_ws" }, null);

    expect(mocks.proxyAwareFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ "ChatGPT-Account-ID": "team_ws" }),
      }),
      null,
    );
  });

  it("keeps chatgptAccountId when provider data also contains proxy fields", async () => {
    const { getCodexUsage } = await import("../../open-sse/services/usage/codex.js");
    const providerSpecificData = {
      chatgptAccountId: "team_ws",
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.example:8080",
    };
    await getCodexUsage("token", providerSpecificData, null);

    expect(mocks.proxyAwareFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ "ChatGPT-Account-ID": "team_ws" }),
      }),
      providerSpecificData,
    );
  });

  it("falls back to the id token account for legacy provider data", async () => {
    const { getCodexUsage } = await import("../../open-sse/services/usage/codex.js");
    await getCodexUsage("token", {}, null, idTokenFor("legacy_ws"));

    expect(mocks.proxyAwareFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ "ChatGPT-Account-ID": "legacy_ws" }),
      }),
      null,
    );
  });

  it("keeps the legacy two-argument proxy call compatible", async () => {
    const { getCodexUsage } = await import("../../open-sse/services/usage/codex.js");
    const proxyOptions = { strictProxy: false };
    await getCodexUsage("token", proxyOptions);

    expect(mocks.proxyAwareFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.not.objectContaining({ "ChatGPT-Account-ID": expect.anything() }),
      }),
      proxyOptions,
    );
  });
});
