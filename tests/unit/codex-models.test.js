import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

describe("Codex model catalog", () => {
  let getCodexModels;
  let proxyAwareFetch;

  beforeEach(async () => {
    vi.resetModules();
    ({ getCodexModels } = await import("../../open-sse/services/usage/codex.js"));
    ({ proxyAwareFetch } = await import("../../open-sse/utils/proxyFetch.js"));
  });

  it("uses the live account catalog and orders supported models by preference", async () => {
    proxyAwareFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        models: [
          { slug: "gpt-low", priority: 10, supported_in_api: true },
          { slug: "gpt-hidden", priority: 100, supported_in_api: false },
          { slug: "gpt-high", priority: 1, supported_in_api: true },
        ],
      }),
    });

    await expect(getCodexModels("token", {}, { chatgptAccountId: "acct-1" })).resolves.toEqual([
      { slug: "gpt-high", priority: 1, supported_in_api: true },
      { slug: "gpt-low", priority: 10, supported_in_api: true },
    ]);

    const [url, options] = proxyAwareFetch.mock.calls[0];
    expect(url.toString()).toBe("https://chatgpt.com/backend-api/codex/models?client_version=0.136.0");
    expect(options.headers).toMatchObject({
      Authorization: "Bearer token",
      "ChatGPT-Account-ID": "acct-1",
    });
  });

  it("returns no models when the catalog request fails", async () => {
    proxyAwareFetch.mockResolvedValue({ ok: false });
    await expect(getCodexModels("token")).resolves.toEqual([]);
  });
});
