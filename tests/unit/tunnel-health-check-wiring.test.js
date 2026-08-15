import { describe, expect, it, vi } from "vitest";

// Mock the shared factory so the wrappers' wiring can be asserted without
// touching real DNS or fetch.
vi.mock("../../src/lib/tunnel/shared/healthCheck.js", () => ({
  createHealthCheck: vi.fn(() => ({
    probeUrlAlive: vi.fn(),
    waitForHealth: vi.fn(),
  })),
}));

import { createHealthCheck } from "../../src/lib/tunnel/shared/healthCheck.js";
import * as cloudflareHealth from "../../src/lib/tunnel/cloudflare/healthCheck.js";
import * as tailscaleHealth from "../../src/lib/tunnel/tailscale/healthCheck.js";
import { HEALTH_CHECK as CF_HEALTH_CHECK } from "../../src/lib/tunnel/cloudflare/config.js";
import { HEALTH_CHECK as TS_HEALTH_CHECK } from "../../src/lib/tunnel/tailscale/config.js";

describe("tunnel health-check wrappers", () => {
  it("keeps the two provider configs distinct (the dedup must not merge them)", () => {
    expect(CF_HEALTH_CHECK.timeoutMs).not.toBe(TS_HEALTH_CHECK.timeoutMs);
    expect(CF_HEALTH_CHECK.fetchTimeoutMs).not.toBe(TS_HEALTH_CHECK.fetchTimeoutMs);
  });

  it("cloudflare wrapper uses the shared factory with the cloudflare config", () => {
    expect(createHealthCheck).toHaveBeenCalledWith(CF_HEALTH_CHECK);
    expect(cloudflareHealth.probeUrlAlive).toBeTypeOf("function");
    expect(cloudflareHealth.waitForHealth).toBeTypeOf("function");
  });

  it("tailscale wrapper uses the shared factory with the tailscale config", () => {
    expect(createHealthCheck).toHaveBeenCalledWith(TS_HEALTH_CHECK);
    expect(tailscaleHealth.probeUrlAlive).toBeTypeOf("function");
    expect(tailscaleHealth.waitForHealth).toBeTypeOf("function");
  });
});
