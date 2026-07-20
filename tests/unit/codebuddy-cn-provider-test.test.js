import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnectionById: vi.fn(),
  updateProviderConnection: vi.fn(),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(),
}));

vi.mock("@/lib/network/proxyTest", () => ({
  testProxyUrl: vi.fn(),
}));

describe("CodeBuddy CN provider test", () => {
  it("validates generated API keys through quota endpoint instead of chat prompt", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({
      code: 0,
      data: { Response: { Data: { Accounts: [] } } },
    }), { status: 200 }));
    const { __test__ } = await import("../../src/app/api/providers/[id]/test/testUtils.js");

    const result = await __test__.testApiKeyConnection({
      provider: "codebuddy-cn",
      apiKey: "ck_test",
      authType: "apikey",
    });

    expect(result).toEqual({ valid: true, error: null });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://copilot.tencent.com/v2/billing/meter/get-user-resource",
      expect.objectContaining({
        method: "POST",
        body: "{}",
      }),
    );
    const body = fetchMock.mock.calls[0][1].body;
    expect(body).not.toContain("messages");
    expect(body).not.toContain("test");
    fetchMock.mockRestore();
  });
});
