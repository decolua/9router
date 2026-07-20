import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProxyPools: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

vi.mock("@/models", () => ({
  getProxyPools: mocks.getProxyPools,
}));

function createQuote() {
  return {
    country: "hongkong",
    product: "codebuddy",
    operator: "any",
    balance: 0.74,
    selectedOffer: { operator: "virtual54", cost: 0.13, count: 153319 },
    availableCount: 153319,
    unitCost: 0.13,
    purchasableByBalance: 5,
    capacity: 5,
    noStockMessage: "",
  };
}

function transientGatewayError(path = "/user/profile") {
  const error = new Error(`5sim HTTP 444 for ${path}: 502 Bad Gateway`);
  error.status = 444;
  error.path = path;
  return error;
}

describe("CodeBuddy CN 5sim quote route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("falls back from direct 5sim readiness check to active proxy pool routes", async () => {
    mocks.getProxyPools.mockResolvedValue([
      {
        id: "pool-1",
        name: "Sillox",
        type: "http",
        isActive: true,
        proxyUrl: "http://proxy-one.local:8080\nhttp://proxy-two.local:8080",
      },
    ]);
    const quoteCalls = [];
    const { __test__ } = await import("../../src/app/api/oauth/codebuddy-cn/5sim-quote/route.js");

    const result = await __test__.getQuoteWithFallback({
      token: "five-token",
      body: { country: "hongkong", operator: "any", product: "codebuddy" },
      resolvedProxy: {
        proxyUrl: null,
        proxyUrls: [],
        proxyMode: "none",
        proxyPoolId: null,
        proxySource: null,
        error: null,
      },
      fiveSimClientFactory: ({ proxyUrl }) => ({
        async getActivationQuote() {
          quoteCalls.push(proxyUrl || "direct");
          if (!proxyUrl) throw transientGatewayError();
          return createQuote();
        },
      }),
    });

    expect(quoteCalls).toEqual(["direct", "http://proxy-one.local:8080"]);
    expect(result.quote.capacity).toBe(5);
    expect(result.route.proxySource).toBe("auto-pool");
    expect(result.route.proxyRoute).toBe("auto proxy pool Sillox #1");
    expect(result.route.fallbackUsed).toBe(true);
    expect(result.route.attemptedRoutes).toBe(2);
  });

  it("tries the next selected proxy before reporting a transient 5sim failure", async () => {
    const quoteCalls = [];
    const { __test__ } = await import("../../src/app/api/oauth/codebuddy-cn/5sim-quote/route.js");

    const result = await __test__.getQuoteWithFallback({
      token: "five-token",
      body: { country: "hongkong", operator: "any", product: "codebuddy", proxyPoolId: "pool-1" },
      resolvedProxy: {
        proxyUrl: "http://bad-proxy.local:8080",
        proxyUrls: ["http://bad-proxy.local:8080", "http://good-proxy.local:8080"],
        proxyMode: "round-robin",
        proxyPoolId: "pool-1",
        proxySource: "pool",
        error: null,
      },
      fiveSimClientFactory: ({ proxyUrl }) => ({
        async getActivationQuote() {
          quoteCalls.push(proxyUrl);
          if (proxyUrl.includes("bad-proxy")) throw transientGatewayError();
          return createQuote();
        },
      }),
    });

    expect(quoteCalls).toEqual(["http://bad-proxy.local:8080", "http://good-proxy.local:8080"]);
    expect(result.route.proxySource).toBe("pool");
    expect(result.route.proxyRoute).toBe("selected proxy pool #2");
    expect(result.route.fallbackUsed).toBe(true);
  });

  it("keeps SOCKS proxy credentials intact when building selected routes", async () => {
    mocks.getProxyPools.mockResolvedValue([
      {
        id: "pool-1",
        name: "Sillox Proxy",
        type: "http",
        isActive: true,
        proxyUrl: "socks5://user:pa;ss,word@134.209.102.0:10000",
      },
    ]);
    const { __test__ } = await import("../../src/app/api/oauth/codebuddy-cn/5sim-quote/route.js");

    const result = await __test__.buildQuoteAttempts({
      proxyUrl: "socks5://user:pa;ss,word@134.209.102.0:10000",
      proxyUrls: ["socks5://user:pa;ss,word@134.209.102.0:10000"],
      proxyMode: "single",
      proxyPoolId: "pool-1",
      proxySource: "pool",
      error: null,
    }, { proxyPoolId: "pool-1" });

    expect(result[0]).toMatchObject({
      proxyUrl: "socks5://user:pa;ss,word@134.209.102.0:10000",
      proxyMode: "single",
      proxyPoolId: "pool-1",
      proxySource: "pool",
      proxyCount: 1,
      proxyRoute: "selected proxy pool #1",
    });
  });

  it("tries another route when a selected proxy cannot create a 5sim client", async () => {
    mocks.getProxyPools.mockResolvedValue([
      {
        id: "pool-2",
        name: "Backup Proxy",
        type: "http",
        isActive: true,
        proxyUrl: "http://good-proxy.local:8080",
      },
    ]);
    const quoteCalls = [];
    const { __test__ } = await import("../../src/app/api/oauth/codebuddy-cn/5sim-quote/route.js");

    const result = await __test__.getQuoteWithFallback({
      token: "five-token",
      body: { country: "hongkong", operator: "any", product: "codebuddy", proxyPoolId: "pool-1" },
      resolvedProxy: {
        proxyUrl: "socks5://bad-proxy.local:10000",
        proxyUrls: ["socks5://bad-proxy.local:10000"],
        proxyMode: "single",
        proxyPoolId: "pool-1",
        proxySource: "pool",
        error: null,
      },
      fiveSimClientFactory: ({ proxyUrl }) => {
        if (proxyUrl?.startsWith("socks5://bad-proxy")) {
          throw new Error("File URL path must be absolute");
        }
        return {
          async getActivationQuote() {
            quoteCalls.push(proxyUrl || "direct");
            return createQuote();
          },
        };
      },
    });

    expect(quoteCalls).toEqual(["http://good-proxy.local:8080"]);
    expect(result.route.proxySource).toBe("auto-pool");
    expect(result.route.proxyRoute).toBe("auto proxy pool Backup Proxy #1");
    expect(result.route.fallbackUsed).toBe(true);
    expect(result.route.attemptedRoutes).toBe(2);
  });
});
