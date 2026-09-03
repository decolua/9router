import { afterEach, describe, expect, it, vi } from "vitest";
import { KiroService } from "../../src/lib/oauth/services/kiro.js";

const originalFetch = globalThis.fetch;

describe("Kiro social OAuth service routing", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("passes selected proxy options to social code exchange fetch", async () => {
    const proxyOptions = {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://proxy.test:8080",
      strictProxy: true,
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: 3600,
      }),
    });

    await new KiroService().exchangeSocialCode("code", "verifier", proxyOptions);

    expect(globalThis.fetch.mock.calls[0][1].proxyOptions).toBe(proxyOptions);
  });
});
