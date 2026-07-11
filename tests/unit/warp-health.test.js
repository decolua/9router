import { describe, expect, it, vi } from "vitest";
import { checkWarpHealth } from "@/lib/network/warpHealth";

const settings = { outboundProxyEnabled: true, outboundProxyUrl: "socks5h://secret@127.0.0.1:40000" };
const connections = [
  { provider: "xai", strictProxy: true, providerSpecificData: { strictProxy: true } },
  { provider: "github", strictProxy: true, providerSpecificData: { strictProxy: false } },
];

describe("checkWarpHealth", () => {
  it.each([
    [{ outboundProxyEnabled: false }, { ok: false }, "not_configured", false, false],
    [settings, { ok: false }, "unreachable", false, false],
    [settings, { ok: true, body: "warp=off\ncolo=SIN" }, "warp_off", true, false],
    [settings, { ok: true, body: "warp=on\ncolo=SIN" }, "healthy", true, true],
  ])("returns sanitized status", async (inputSettings, probeResult, status, reachable, warp) => {
    const result = await checkWarpHealth({
      settings: inputSettings,
      listConnections: vi.fn().mockResolvedValue(connections),
      probe: vi.fn().mockResolvedValue(probeResult),
      now: () => new Date("2026-07-11T16:00:00.000Z"),
    });
    expect(result).toEqual({
      configured: inputSettings.outboundProxyEnabled === true,
      reachable,
      warp,
      strictConnections: 1,
      checkedAt: "2026-07-11T16:00:00.000Z",
      status,
    });
    expect(JSON.stringify(result)).not.toMatch(/socks5h|secret|colo|body|proxyUrl|token|cookie|password|email/i);
  });
});
