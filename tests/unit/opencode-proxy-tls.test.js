import { describe, it, expect, vi, beforeEach } from "vitest";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { OpenCodeExecutor } from "../../open-sse/executors/opencode.js";

const { opencodeTlsFetchMock } = vi.hoisted(() => ({
  opencodeTlsFetchMock: vi.fn(),
}));

vi.mock("../../open-sse/services/opencodeTlsClient.js", () => ({
  opencodeTlsFetch: opencodeTlsFetchMock,
  resetOpencodeTlsSession: vi.fn(),
}));

describe("opencode proxy TLS routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to directFetch with proxyUrl when directFetch.supportsProxy is true", async () => {
    const directFetch = vi.fn(async (url, options) => new Response(`proxied:${options.proxyUrl}`));
    directFetch.supportsProxy = true;

    const proxyOptions = {
      enabled: true,
      url: "socks5://10.88.0.3:1081",
    };

    const res = await proxyAwareFetch(
      "https://opencode.ai/inference/v1/chat/completions",
      { method: "POST", body: "{}", directFetch },
      proxyOptions
    );

    expect(await res.text()).toBe("proxied:socks5://10.88.0.3:1081");
    expect(directFetch).toHaveBeenCalledTimes(1);
    expect(directFetch).toHaveBeenCalledWith(
      "https://opencode.ai/inference/v1/chat/completions",
      expect.objectContaining({
        proxyUrl: "socks5://10.88.0.3:1081",
      })
    );
  });

  it("bypasses directFetch when directFetch does not set supportsProxy on proxied requests", async () => {
    const directFetch = vi.fn(async () => new Response("direct"));

    const proxyOptions = {
      enabled: true,
      url: "http://127.0.0.1:8888",
    };

    // Should attempt undici dispatcher and not call directFetch
    // undici fetch to unreachable 127.0.0.1:8888 will fail, verifying directFetch was bypassed
    await expect(
      proxyAwareFetch(
        "https://opencode.ai/inference/v1/chat/completions",
        { method: "POST", body: "{}", directFetch },
        { ...proxyOptions, strictProxy: true }
      )
    ).rejects.toThrow();

    expect(directFetch).not.toHaveBeenCalled();
  });

  it("OpenCodeExecutor configures directFetch with supportsProxy = true and forwards proxyUrl", async () => {
    opencodeTlsFetchMock.mockResolvedValue(new Response("ok", { status: 200 }));

    const executor = new OpenCodeExecutor();
    const proxyOptions = {
      enabled: true,
      url: "socks5://10.88.0.106:1080",
    };

    const result = await executor.execute({
      model: "deepseek-v4.1-flash",
      body: { messages: [{ role: "user", content: "hello" }] },
      stream: true,
      proxyOptions,
    });

    expect(result.response.status).toBe(200);
    expect(opencodeTlsFetchMock).toHaveBeenCalledTimes(1);
    expect(opencodeTlsFetchMock).toHaveBeenCalledWith(
      "https://opencode.ai/inference/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
      expect.objectContaining({ proxy: "socks5://10.88.0.106:1080" })
    );
  });
});
