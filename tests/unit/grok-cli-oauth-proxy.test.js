import { afterEach, describe, expect, it, vi } from "vitest";
import { getProvider } from "../../src/lib/oauth/providers.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Grok CLI OAuth proxy propagation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses selected proxy for device request, polling, and profile lookup", async () => {
    const provider = getProvider("grok-cli");
    const proxyOptions = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://127.0.0.1:18888",
      strictProxy: true,
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({ device_code: "device", user_code: "CODE" }))
      .mockResolvedValueOnce(jsonResponse({ error: "authorization_pending" }, 400))
      .mockResolvedValueOnce(jsonResponse({ email: "user@example.com" }));

    await provider.requestDeviceCode(provider.config, undefined, {}, proxyOptions);
    await provider.pollToken(provider.config, "device", null, null, proxyOptions);
    await provider.postExchange({ access_token: "token" }, proxyOptions);

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(fetchSpy.mock.calls[0][1].proxyOptions).toBe(proxyOptions);
    expect(fetchSpy.mock.calls[1][1].proxyOptions).toBe(proxyOptions);
    expect(fetchSpy.mock.calls[2][1].proxyOptions).toBe(proxyOptions);
    expect(fetchSpy.mock.calls[0][1].headers["User-Agent"]).toContain("0.2.99");
    expect(fetchSpy.mock.calls[2][1].headers["x-grok-client-identifier"]).toBe("grok-shell");
  });
});
