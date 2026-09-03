import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProxyPoolById: vi.fn(),
}));

vi.mock("@/models", () => ({
  getProxyPoolById: mocks.getProxyPoolById,
}));

import { resolveConnectionProxyConfig } from "../../src/lib/network/connectionProxy.js";
import { resolveRefreshProxyOptions } from "../../open-sse/services/oauthCredentialManager.js";

describe("explicit proxy-pool failure", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["missing", null],
    ["inactive", { id: "pool-1", isActive: false, proxyUrl: "http://proxy.test:8080" }],
    ["malformed", { id: "pool-1", isActive: true, proxyUrl: "::::" }],
  ])("marks %s selected pool unavailable", async (_label, pool) => {
    mocks.getProxyPoolById.mockResolvedValue(pool);

    const resolved = await resolveConnectionProxyConfig({ proxyPoolId: "pool-1" });

    expect(resolved).toMatchObject({
      source: "unavailable",
      proxyPoolId: "pool-1",
      proxyUnavailable: true,
    });
  });

  it("keeps explicit Direct distinct from unavailable pool", async () => {
    const resolved = await resolveConnectionProxyConfig({ proxyPoolId: "__none__" });

    expect(resolved.source).toBe("none");
    expect(resolved.proxyUnavailable).not.toBe(true);
    expect(mocks.getProxyPoolById).not.toHaveBeenCalled();
  });

  it("rejects refresh before network when selected pool is unavailable", () => {
    expect(() => resolveRefreshProxyOptions({
      providerSpecificData: {
        proxyPoolId: "pool-1",
        proxyUnavailable: true,
      },
    })).toThrow("Proxy pool pool-1 is unavailable");
  });
});
