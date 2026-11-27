import http from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startCodexProxy, stopCodexProxy } from "../../src/lib/oauth/utils/server.js";

const listen = http.Server.prototype.listen;

afterEach(() => {
  stopCodexProxy();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Codex OAuth callback listener", () => {
  it.each([
    [undefined, "127.0.0.1"],
    ["false", "127.0.0.1"],
    ["true", "0.0.0.0"],
  ])("uses the expected bind address with CODEX_OAUTH_CALLBACK_BIND_ALL=%s", async (setting, expectedHost) => {
    vi.stubEnv("CODEX_OAUTH_CALLBACK_BIND_ALL", setting);
    let callbackServer;
    const listenSpy = vi.spyOn(http.Server.prototype, "listen").mockImplementation(function (_port, host, callback) {
      callbackServer = this;
      return listen.call(this, 0, host, callback);
    });

    expect(await startCodexProxy(20128)).toEqual({ success: true });
    expect(listenSpy).toHaveBeenCalledWith(1455, expectedHost, expect.any(Function));
    const { address, port } = callbackServer.address();
    expect(address).toBe(expectedHost);

    const callbackUrl = `http://127.0.0.1:${port}/auth/callback?state=example`;
    const rejected = await fetch(callbackUrl, {
      headers: { Origin: "https://example.org" },
      redirect: "manual",
    });
    expect(rejected.status).toBe(403);

    const navigation = await fetch(callbackUrl, { redirect: "manual" });
    expect(navigation.status).toBe(302);
    expect(navigation.headers.get("location")).toBe("http://localhost:20128/callback?state=example");
  });
});
