import { describe, it, expect, vi, afterEach } from "vitest";

const STALL_ENV = "NINE_ROUTER_STREAM_STALL_TIMEOUT_MS";
const FETCH_ENV = "NINE_ROUTER_FETCH_CONNECT_TIMEOUT_MS";

const importFresh = async () => {
  vi.resetModules();
  return import("../../open-sse/config/runtimeConfig.js");
};

describe("runtimeConfig env overrides", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses the env value when NINE_ROUTER_STREAM_STALL_TIMEOUT_MS is set", async () => {
    vi.stubEnv(STALL_ENV, "60000");
    const mod = await importFresh();
    expect(mod.STREAM_STALL_TIMEOUT_MS).toBe(60000);
  });
});