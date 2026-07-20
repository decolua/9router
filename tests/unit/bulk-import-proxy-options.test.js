import { describe, expect, it } from "vitest";
import {
  formatBrowserProxyPoolOption,
  getBrowserProxyPools,
} from "../../src/lib/oauth/services/bulkImportProxyOptions.js";

describe("bulk import proxy options", () => {
  it("shows an active browser proxy pool with the number of proxies it contains", () => {
    const pools = getBrowserProxyPools({
      proxyPools: [
        {
          id: "relay",
          name: "vercel-relay",
          type: "vercel",
          isActive: true,
          proxyUrl: "https://relay.example.com",
        },
        {
          id: "sillox",
          name: "Sillox Proxy",
          type: "http",
          isActive: true,
          proxyUrl: "http://one.example.com:8080\nhttp://two.example.com:8080",
        },
      ],
    });

    expect(pools).toHaveLength(2);
    expect(pools[0].browserCompatible).toBe(false);
    expect(formatBrowserProxyPoolOption(pools[0])).toBe("vercel-relay (relay - unavailable for browser)");
    expect(pools[1].id).toBe("sillox");
    expect(pools[1].browserCompatible).toBe(true);
    expect(formatBrowserProxyPoolOption(pools[1])).toBe("Sillox Proxy (2 proxies)");
  });

  it("does not split proxy credentials that contain separator characters", () => {
    const pools = getBrowserProxyPools({
      proxyPools: [
        {
          id: "sillox",
          name: "Sillox Proxy",
          type: "http",
          isActive: true,
          proxyUrl: "socks5://user:pa;ss,word@134.209.102.0:10000",
        },
      ],
    });

    expect(formatBrowserProxyPoolOption(pools[0])).toBe("Sillox Proxy (1 proxy)");
  });
});
