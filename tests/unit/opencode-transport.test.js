import { afterEach, describe, expect, it, vi } from "vitest";

// The free-tier gate fingerprints the TLS/HTTP stack: the same body and headers
// that stream 200 through Bun fetch are answered `429 FreeUsageLimitError`
// through Node/undici (measured 5/5 either way, only the transport differing).
// These tests pin the transport plumbing that keeps the free lane on Bun.
describe("openCode egress resolution", () => {
  const original = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in original)) delete process.env[key];
    }
    Object.assign(process.env, original);
    vi.resetModules();
  });

  it("uses the connection proxy when one is enabled", async () => {
    const { resolveEffectiveProxyUrl } = await import("../../open-sse/utils/proxyResolution.js");
    const resolved = resolveEffectiveProxyUrl("https://opencode.ai/inference/v1/chat/completions", {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://127.0.0.1:7890",
    });
    expect(resolved).toEqual({ url: "http://127.0.0.1:7890", source: "connection" });
  });

  it("honours NO_PROXY before the connection proxy", async () => {
    const { resolveEffectiveProxyUrl } = await import("../../open-sse/utils/proxyResolution.js");
    const resolved = resolveEffectiveProxyUrl("https://opencode.ai/x", {
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://127.0.0.1:7890",
      connectionNoProxy: "opencode.ai",
    });
    expect(resolved).toEqual({ url: "", source: "no_proxy" });
  });

  it("prefers the relay when one is configured", async () => {
    const { resolveEffectiveProxyUrl } = await import("../../open-sse/utils/proxyResolution.js");
    const resolved = resolveEffectiveProxyUrl("https://opencode.ai/x", {
      vercelRelayUrl: "https://relay.example/forward",
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://127.0.0.1:7890",
    });
    expect(resolved.source).toBe("relay");
  });

  it("falls back to the env proxy, then to direct", async () => {
    const { resolveEffectiveProxyUrl } = await import("../../open-sse/utils/proxyResolution.js");
    for (const key of ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"]) {
      delete process.env[key];
    }
    expect(resolveEffectiveProxyUrl("https://opencode.ai/x", null)).toEqual({ url: "", source: "direct" });
    process.env.HTTPS_PROXY = "127.0.0.1:7890";
    expect(resolveEffectiveProxyUrl("https://opencode.ai/x", null)).toEqual({
      url: "http://127.0.0.1:7890",
      source: "env",
    });
  });

  it("adds a scheme to a bare proxy string", async () => {
    const { normalizeString, resolveEffectiveProxyUrl } = await import("../../open-sse/utils/proxyResolution.js");
    expect(normalizeString("  x  ")).toBe("x");
    expect(normalizeString(undefined)).toBe("");
    const resolved = resolveEffectiveProxyUrl("https://opencode.ai/x", {
      connectionProxyEnabled: true,
      connectionProxyUrl: "127.0.0.1:8080",
    });
    expect(resolved.url).toBe("http://127.0.0.1:8080");
  });
});

describe("BaseExecutor.fetchUpstream", () => {
  it("is an overridable seam", async () => {
    const { BaseExecutor } = await import("../../open-sse/executors/base.js");
    expect(typeof BaseExecutor.prototype.fetchUpstream).toBe("function");
  });
});

describe("openCode transport configuration", () => {
  afterEach(() => {
    delete process.env.OPENCODE_BUN_BIN;
    delete process.env.OPENCODE_TRANSPORT;
    vi.resetModules();
  });

  it("prefers an explicit OPENCODE_BUN_BIN", async () => {
    process.env.OPENCODE_BUN_BIN = "D:/custom/bun.exe";
    vi.resetModules();
    const { OPENCODE_TRANSPORT_CONFIG } = await import("../../open-sse/config/runtimeConfig.js");
    expect(OPENCODE_TRANSPORT_CONFIG.bunBin).toBe("D:/custom/bun.exe");
  });

  it("can be switched off without a rebuild", async () => {
    process.env.OPENCODE_TRANSPORT = "off";
    vi.resetModules();
    const { OPENCODE_TRANSPORT_CONFIG } = await import("../../open-sse/config/runtimeConfig.js");
    expect(OPENCODE_TRANSPORT_CONFIG.mode).toBe("off");
  });
});
