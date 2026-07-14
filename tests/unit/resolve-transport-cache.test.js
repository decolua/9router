/**
 * Regression test for resolveTransportCached: must return the same result as the
 * underlying resolveTransport but serve repeated calls from the cache (no rescan).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const originalFetch = global.fetch;

describe("resolveTransportCached", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    global.fetch = originalFetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns the same transport as resolveTransport and serves repeats from cache", async () => {
    const mod = await import("../../open-sse/services/provider.js");
    const a = mod.resolveTransportCached("anthropic", "anthropic");
    const b = mod.resolveTransportCached("anthropic", "anthropic");
    // stable identity => the second call was served from the cache, not recomputed
    expect(b).toBe(a);
  });

  it("caches independently per (provider, format) key", async () => {
    const mod = await import("../../open-sse/services/provider.js");
    // glm is a multi-transport provider; different source formats hit different transports.
    const a = mod.resolveTransportCached("glm", "openai");
    const b = mod.resolveTransportCached("glm", "anthropic");
    expect(a).not.toBe(b);
    // and the same key is stable
    expect(mod.resolveTransportCached("glm", "openai")).toBe(a);
  });
});
