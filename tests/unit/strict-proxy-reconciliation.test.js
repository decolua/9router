import { beforeEach, describe, expect, it, vi } from "vitest";

describe("reconcileStrictProxyConnections", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("repairs only drifted sensitive rows and preserves credentials", async () => {
    const listConnections = vi.fn().mockResolvedValue([
      {
        id: "ag-1",
        provider: "antigravity",
        accessToken: "secret-token",
        strictProxy: false,
        providerSpecificData: { projectId: "proj", cookie: "c=1", strictProxy: false },
      },
      {
        id: "xai-1",
        provider: "xai",
        apiKey: "xai-secret",
        strictProxy: true,
        providerSpecificData: { strictProxy: true },
      },
      {
        id: "openai-1",
        provider: "openai",
        strictProxy: false,
        providerSpecificData: { strictProxy: false },
      },
    ]);
    const updateConnection = vi.fn().mockImplementation(async (id, data) => ({ id, ...data }));
    const log = { info: vi.fn() };
    const { reconcileStrictProxyConnections } = await import("@/lib/network/strictProxyReconciliation");

    const first = await reconcileStrictProxyConnections({ listConnections, updateConnection, log });
    const second = await reconcileStrictProxyConnections({ listConnections, updateConnection, log });

    expect(first).toEqual({ checked: 3, repaired: 1 });
    expect(second).toEqual({ checked: 3, repaired: 1 });
    expect(updateConnection).toHaveBeenCalledTimes(2);
    expect(updateConnection).toHaveBeenCalledWith("ag-1", {
      strictProxy: true,
      providerSpecificData: {
        projectId: "proj",
        cookie: "c=1",
        strictProxy: true,
      },
    });
    expect(JSON.stringify(log.info.mock.calls)).not.toMatch(/secret-token|xai-secret|c=1/);
    expect(log.info).toHaveBeenCalledWith(
      { checked: 3, repaired: 1 },
      "[StrictProxy] reconciliation completed",
    );
  });

  it("repairs missing nested strictProxy on sensitive providers", async () => {
    const listConnections = vi.fn().mockResolvedValue([
      {
        id: "gh-1",
        provider: "github",
        strictProxy: true,
        providerSpecificData: { account: "a" },
      },
    ]);
    const updateConnection = vi.fn().mockResolvedValue({});
    const { reconcileStrictProxyConnections } = await import("@/lib/network/strictProxyReconciliation");
    const result = await reconcileStrictProxyConnections({ listConnections, updateConnection, log: { info: vi.fn() } });
    expect(result).toEqual({ checked: 1, repaired: 1 });
    expect(updateConnection).toHaveBeenCalledWith("gh-1", {
      strictProxy: true,
      providerSpecificData: { account: "a", strictProxy: true },
    });
  });
});
