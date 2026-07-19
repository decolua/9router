import { afterEach, describe, expect, it, vi } from "vitest";
import { refreshKimiToken, refreshTokenByProvider } from "../../open-sse/services/tokenRefresh.js";
import { getProvider } from "../../src/lib/oauth/providers.js";

describe("Kimi OAuth proxy propagation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses selected proxy for device request and poll", async () => {
    const provider = getProvider("kimi");
    const proxyOptions = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.test:8080",
      strictProxy: true,
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        device_code: "device-code",
        user_code: "USER-CODE",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: "authorization_pending",
      }), { status: 200 }));

    const device = await provider.requestDeviceCode(provider.config, undefined, {}, proxyOptions);
    await provider.pollToken(
      provider.config,
      device.device_code,
      null,
      { _kimiDeviceId: device._kimiDeviceId },
      proxyOptions,
    );

    expect(fetchSpy.mock.calls[0][1].proxyOptions).toBe(proxyOptions);
    expect(fetchSpy.mock.calls[1][1].proxyOptions).toBe(proxyOptions);
    expect(fetchSpy.mock.calls[1][1].headers["X-Msh-Device-Id"]).toBe(device._kimiDeviceId);
  });

  it("uses selected proxy for token refresh", async () => {
    const proxyOptions = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.test:8080",
      strictProxy: true,
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await refreshKimiToken(
      "old-refresh",
      { providerSpecificData: { deviceId: "device-1" } },
      null,
      proxyOptions,
    );

    expect(fetchSpy.mock.calls[0][1].proxyOptions).toBe(proxyOptions);
  });

  it("keeps selected proxy through refresh dispatch", async () => {
    const proxyOptions = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.test:8080",
      strictProxy: true,
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      access_token: "new-access",
      refresh_token: "new-refresh",
      expires_in: 3600,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await refreshTokenByProvider("kimi", {
      refreshToken: "dispatch-refresh",
      providerSpecificData: { deviceId: "device-1" },
    }, null, proxyOptions);

    expect(fetchSpy.mock.calls[0][1].proxyOptions).toBe(proxyOptions);
  });
});
