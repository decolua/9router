import { describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
vi.mock("open-sse/utils/proxyFetch.js", () => ({ proxyAwareFetch: fetchMock }));

const { DefaultExecutor } = await import("open-sse/executors/default.js");

describe("compatible node custom headers", () => {
  it.each([
    ["openai-compatible-node", { baseUrl: "https://openai.example/v1", apiType: "chat" }, "https://openai.example/v1/chat/completions"],
    ["anthropic-compatible-node", { baseUrl: "https://anthropic.example/v1" }, "https://anthropic.example/v1/messages"],
  ])("forwards configured headers to %s", async (provider, providerSpecificData, url) => {
    fetchMock.mockResolvedValueOnce(new Response("{}"));

    await new DefaultExecutor(provider).execute({
      model: "test-model",
      body: { model: "test-model", messages: [] },
      stream: false,
      credentials: { apiKey: "test-key", providerSpecificData },
      providerOverrides: { headers: { "X-Gateway-Name": "test-gateway" } },
    });

    expect(fetchMock).toHaveBeenCalledWith(url, expect.objectContaining({
      headers: expect.objectContaining({ "X-Gateway-Name": "test-gateway" }),
    }), null);
  });
});