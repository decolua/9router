import { beforeEach, describe, expect, it, vi } from "vitest";

const getSettings = vi.fn();
const getProviderConnections = vi.fn();
const probeWarpTrace = vi.fn();
const checkWarpHealth = vi.fn();

vi.mock("@/lib/localDb", () => ({ getSettings, getProviderConnections }));
vi.mock("@/lib/network/warpHealth", () => ({ checkWarpHealth, probeWarpTrace }));

describe("GET /api/settings/warp-health", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    getSettings.mockResolvedValue({ outboundProxyEnabled: true });
    checkWarpHealth.mockResolvedValue({
      configured: true,
      reachable: true,
      warp: true,
      strictConnections: 11,
      checkedAt: "2026-07-11T16:00:00.000Z",
      status: "healthy",
    });
  });

  it("returns only the sanitized DTO with no-store headers", async () => {
    const { GET } = await import("@/app/api/settings/warp-health/route");
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      configured: true,
      reachable: true,
      warp: true,
      strictConnections: 11,
      checkedAt: "2026-07-11T16:00:00.000Z",
      status: "healthy",
    });
    expect(checkWarpHealth).toHaveBeenCalledWith(expect.objectContaining({
      settings: { outboundProxyEnabled: true },
      listConnections: getProviderConnections,
      probe: probeWarpTrace,
    }));
  });

  it("does not leak internal errors", async () => {
    checkWarpHealth.mockRejectedValue(new Error("socks5h://user:secret@127.0.0.1"));
    const { GET } = await import("@/app/api/settings/warp-health/route");
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ status: "error" });
  });
});
