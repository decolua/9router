/**
 * #3424 — `ollama-local` returned 503 "Provider error" while Ollama was reachable.
 *
 * `proxyAwareFetch` applied `HTTP_PROXY` / `HTTPS_PROXY` to every target, loopback
 * included. A proxy resolves `localhost` against its OWN machine, so a request to
 * a local provider could not succeed once those variables were set — the normal
 * state on a corporate Windows box. That also explains the reporter's evidence:
 * `curl` and a bare `fetch()` in Node both worked, because Node's fetch ignores
 * the proxy environment entirely; only 9router applied it.
 *
 * The bypass is deliberately limited to loopback. A remote Ollama on a LAN address
 * can legitimately need the proxy, and `NO_PROXY` still covers that.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { isLoopbackTarget } from "open-sse/utils/proxyFetch.js";

/**
 * Import a fresh copy of the module with `globalThis.fetch` stubbed, so the
 * `originalFetch` it captures at load time is the spy. Returns the spy plus the
 * module, and restores the real fetch on teardown.
 */
async function withStubbedFetch(env) {
  const realFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), hasDispatcher: options?.dispatcher !== undefined });
    return new Response("{}", { status: 200 });
  };
  vi.resetModules();
  const previousEnv = {};
  for (const [key, value] of Object.entries(env)) {
    previousEnv[key] = process.env[key];
    process.env[key] = value;
  }
  const mod = await import("open-sse/utils/proxyFetch.js");
  return {
    calls,
    proxyAwareFetch: mod.proxyAwareFetch,
    restore() {
      globalThis.fetch = realFetch;
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    },
  };
}

describe("loopback proxy bypass (#3424)", () => {
  it("treats the ollama-local default endpoint as loopback", () => {
    expect(isLoopbackTarget("http://localhost:11434/api/chat")).toBe(true);
  });

  it.each([
    "http://127.0.0.1:8080",
    "http://127.1.2.3/api",
    "https://localhost/v1/chat/completions",
    "http://foo.localhost:3000",
    "http://[::1]:1234",
    "http://[0:0:0:0:0:0:0:1]",
  ])("bypasses %s", (url) => {
    expect(isLoopbackTarget(url)).toBe(true);
  });

  it("bypasses IPv4-mapped loopback in both spellings", () => {
    // `new URL()` re-serializes the dotted form as ::ffff:7f00:1, so both must match.
    expect(isLoopbackTarget("http://[::ffff:127.0.0.1]:80")).toBe(true);
    expect(isLoopbackTarget("http://[::ffff:7f00:1]")).toBe(true);
  });

  it.each([
    "https://api.openai.com/v1/chat/completions",
    "http://192.168.1.10:11434/api/chat",
    "http://10.0.0.5:8080",
    "http://[::ffff:192.168.1.1]",
    "http://notlocalhost.com",
    "http://localhost.evil.com",
    "http://127.0.0.1.evil.com",
  ])("still proxies %s", (url) => {
    expect(isLoopbackTarget(url)).toBe(false);
  });

  it("does not throw on a malformed target", () => {
    expect(isLoopbackTarget("not a url")).toBe(false);
    expect(isLoopbackTarget("")).toBe(false);
  });
});

describe("proxyAwareFetch honours the bypass (#3424)", () => {
  let harness = null;
  afterEach(() => { harness?.restore(); harness = null; });

  it("does not attach a proxy dispatcher for a loopback target when HTTP_PROXY is set", async () => {
    harness = await withStubbedFetch({ HTTP_PROXY: "http://corp-proxy:3128", NO_PROXY: "" });

    await harness.proxyAwareFetch("http://localhost:11434/api/chat", { method: "POST" });

    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0].hasDispatcher).toBe(false);
  });

  it("ignores a connection-level proxy for a loopback target", async () => {
    harness = await withStubbedFetch({ NO_PROXY: "" });

    await harness.proxyAwareFetch("http://127.0.0.1:11434/api/chat", {}, {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://corp-proxy:3128",
    });

    expect(harness.calls).toHaveLength(1);
    expect(harness.calls[0].hasDispatcher).toBe(false);
  });
});
