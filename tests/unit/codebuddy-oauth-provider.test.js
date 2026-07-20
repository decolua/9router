import { beforeEach, describe, expect, it, vi } from "vitest";

describe("CodeBuddy OAuth provider", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("runs the global CodeBuddy device OAuth polling flow", async () => {
    const fetchMock = fetch;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            state: "state-1",
            authUrl: "https://www.codebuddy.ai/login?platform=CLI&state=state-1",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            accessToken: "access-1",
            refreshToken: "refresh-1",
            tokenType: "Bearer",
            expiresIn: 86400,
          },
        }),
      });

    const { requestDeviceCode, pollForToken } = await import("../../src/lib/oauth/providers.js");

    const deviceData = await requestDeviceCode("codebuddy");
    const tokenResult = await pollForToken("codebuddy", deviceData.device_code);

    expect(fetchMock.mock.calls[0][0]).toBe("https://www.codebuddy.ai/v2/plugin/auth/state?platform=CLI");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: expect.objectContaining({
        "User-Agent": "CLI/2.105.2 CodeBuddy/2.105.2",
        "X-Domain": "www.codebuddy.ai",
      }),
      body: "{}",
    });
    expect(fetchMock.mock.calls[1][0]).toBe("https://www.codebuddy.ai/v2/plugin/auth/token?state=state-1");
    expect(fetchMock.mock.calls[1][1].headers).toEqual(expect.objectContaining({
      "X-Domain": "www.codebuddy.ai",
    }));
    expect(deviceData).toMatchObject({
      device_code: "state-1",
      verification_uri: "https://www.codebuddy.ai/login?platform=CLI&state=state-1",
      interval: 5,
    });
    expect(tokenResult).toEqual({
      success: true,
      tokens: {
        accessToken: "access-1",
        refreshToken: "refresh-1",
        expiresIn: 86400,
        providerSpecificData: {},
      },
    });
  });

  it("keeps CodeBuddy CN on the Tencent OAuth endpoint", async () => {
    const fetchMock = fetch;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        code: 0,
        data: {
          state: "cn-state-1",
          authUrl: "https://copilot.tencent.com/login?platform=CLI&state=cn-state-1",
        },
      }),
    });

    const { requestDeviceCode } = await import("../../src/lib/oauth/providers.js");

    const deviceData = await requestDeviceCode("codebuddy-cn");

    expect(fetchMock.mock.calls[0][0]).toBe("https://copilot.tencent.com/v2/plugin/auth/state?platform=CLI");
    expect(fetchMock.mock.calls[0][1].headers).toEqual(expect.objectContaining({
      "User-Agent": "CLI/2.63.2 CodeBuddy/2.63.2",
      "X-Domain": "copilot.tencent.com",
    }));
    expect(deviceData).toMatchObject({
      device_code: "cn-state-1",
      verification_uri: "https://copilot.tencent.com/login?platform=CLI&state=cn-state-1",
      interval: 5,
    });
  });
});
