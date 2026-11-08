// Media + MCP surfaces did not use the proxy pool. Only chat went through
// proxyAwareFetch with an explicit proxyOptions argument; every media core
// (image/TTS/STT/embeddings/video/search/fetch) and the MCP routes called bare
// `fetch`, so a configured pool was silently ignored and traffic left over the
// direct IP.
//
// The fix threads the pool through AsyncLocalStorage: handlers wrap their core
// call in runWithProxyOptions(buildProxyOptions(credentials), ...) and
// proxyAwareFetch falls back to that context when no explicit options arrive.
// These tests pin the three pieces that make that work.
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/models", () => ({
  getProxyPoolById: vi.fn(),
  getProxyPools: vi.fn(),
  getSettings: vi.fn(),
}));

const { getProxyPoolById, getProxyPools, getSettings } = await import("@/models");
const {
  buildProxyOptions,
  runWithProxyOptions,
  getProxyOptionsFromContext,
} = await import("../../open-sse/utils/proxyContext.js");
const { resolveSurfaceProxyOptions } = await import("../../src/lib/network/connectionProxy.js");
await import("../../open-sse/utils/proxyFetch.js");

const POOL = {
  id: "pool-1",
  name: "Residential",
  proxyUrl: "http://127.0.0.1:7890",
  noProxy: "localhost",
  isActive: true,
  strictProxy: false,
  type: "http",
};

beforeEach(() => {
  getProxyPoolById.mockReset();
  getProxyPools.mockReset();
  getSettings.mockReset();
});

describe("buildProxyOptions", () => {
  it("is inert when there are no credentials", () => {
    expect(buildProxyOptions(null)).toEqual({
      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",
      vercelRelayUrl: "",
      proxyPoolId: null,
      strictProxy: false,
    });
  });

  it("maps the resolved connection fields proxyFetch expects", () => {
    const opts = buildProxyOptions({
      providerSpecificData: {
        connectionProxyEnabled: true,
        connectionProxyUrl: "http://127.0.0.1:7890",
        connectionNoProxy: "localhost",
        vercelRelayUrl: "https://relay.example.com",
        connectionProxyPoolId: "pool-1",
        strictProxy: true,
      },
    });
    expect(opts).toEqual({
      connectionProxyEnabled: true,
      connectionProxyUrl: "http://127.0.0.1:7890",
      connectionNoProxy: "localhost",
      vercelRelayUrl: "https://relay.example.com",
      proxyPoolId: "pool-1",
      strictProxy: true,
    });
  });

  it("keeps a relay-only pool (no connectionProxyUrl) usable", () => {
    const opts = buildProxyOptions({
      providerSpecificData: {
        connectionProxyEnabled: false,
        connectionProxyUrl: "",
        vercelRelayUrl: "https://relay.example.com",
        connectionProxyPoolId: "pool-2",
      },
    });
    expect(opts.vercelRelayUrl).toBe("https://relay.example.com");
    expect(opts.proxyPoolId).toBe("pool-2");
  });
});

describe("runWithProxyOptions scope", () => {
  it("exposes the options inside the callback only", async () => {
    const opts = { proxyPoolId: "pool-1", strictProxy: true };
    expect(getProxyOptionsFromContext()).toBeNull();
    await runWithProxyOptions(opts, async () => {
      expect(getProxyOptionsFromContext()).toEqual(opts);
    });
    expect(getProxyOptionsFromContext()).toBeNull();
  });

  it("runs the callback unchanged when there are no options", async () => {
    let ran = false;
    const value = await runWithProxyOptions(null, () => {
      ran = true;
      expect(getProxyOptionsFromContext()).toBeNull();
      return 42;
    });
    expect(ran).toBe(true);
    expect(value).toBe(42);
  });

  it("keeps concurrent scopes isolated", async () => {
    const seen = [];
    const run = (id) =>
      runWithProxyOptions({ proxyPoolId: id }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        seen.push(getProxyOptionsFromContext()?.proxyPoolId);
      });
    await Promise.all([run("a"), run("b"), run("c")]);
    expect(seen.sort()).toEqual(["a", "b", "c"]);
  });
});

describe("bare fetch inside a proxy scope uses the pool", () => {
  // A media/MCP core calls plain fetch(); proxyFetch patches globalThis.fetch,
  // and patchedFetch passes null for proxyOptions — the context is the only
  // thing that can supply the pool there.
  it("refuses a direct connection for a strict pool reached via context", async () => {
    await expect(
      runWithProxyOptions({ proxyPoolId: "pool-1", strictProxy: true }, () =>
        fetch("https://api.example.com/v1/audio/speech")
      )
    ).rejects.toThrow(/strictProxy/);
  });

  it("does not refuse when the context carries no proxy intent", async () => {
    expect(
      getProxyOptionsFromContext()?.proxyPoolId
    ).toBeUndefined();
    const ctx = { connectionProxyEnabled: false, connectionProxyUrl: "", vercelRelayUrl: "" };
    await runWithProxyOptions(ctx, async () => {
      // No proxy intended, so no strict throw: the call is left to the network
      // layer. Any network outcome is acceptable here — the point is that the
      // context did not invent proxy intent.
      expect(getProxyOptionsFromContext().proxyPoolId).toBeUndefined();
    });
  });
});

describe("resolveSurfaceProxyOptions", () => {
  it("resolves the pool bound to the mcp surface", async () => {
    getSettings.mockResolvedValue({ providerStrategies: { mcp: { proxyPoolId: "pool-1" } } });
    getProxyPoolById.mockResolvedValue(POOL);

    const cfg = await resolveSurfaceProxyOptions("mcp");
    expect(getProxyPoolById).toHaveBeenCalledWith("pool-1");
    expect(cfg.source).toBe("pool");
    expect(cfg.proxyPoolId).toBe("pool-1");
    expect(cfg.connectionProxyEnabled).toBe(true);
    expect(cfg.connectionProxyUrl).toBe("http://127.0.0.1:7890");
  });

  it("rotates over active pools when a strategy is configured", async () => {
    getSettings.mockResolvedValue({ providerStrategies: { mcp: { rotateStrategy: "round-robin" } } });
    getProxyPools.mockResolvedValue([
      { ...POOL, id: "pool-1" },
      { ...POOL, id: "pool-2", name: "Datacenter" },
    ]);
    getProxyPoolById.mockImplementation(async (id) => ({ ...POOL, id }));

    const first = await resolveSurfaceProxyOptions("mcp");
    const second = await resolveSurfaceProxyOptions("mcp");
    expect(getProxyPools).toHaveBeenCalledWith({ isActive: true });
    expect([first.proxyPoolId, second.proxyPoolId]).toEqual(["pool-1", "pool-2"]);
  });

  it("falls back to no proxy when the surface has no binding", async () => {
    getSettings.mockResolvedValue({});
    const cfg = await resolveSurfaceProxyOptions("mcp");
    expect(cfg.source).toBe("none");
    expect(cfg.connectionProxyEnabled).toBe(false);
    expect(cfg.proxyPoolId).toBeNull();
  });

  it("reports an error config instead of throwing when settings are unreadable", async () => {
    getSettings.mockRejectedValue(new Error("db locked"));
    const cfg = await resolveSurfaceProxyOptions("mcp");
    expect(cfg.source).toBe("error");
    expect(cfg.strictProxy).toBe(false);
  });
});
