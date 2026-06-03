import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";

const STALL_ENV = "NINE_ROUTER_STREAM_STALL_TIMEOUT_MS";
const FETCH_ENV = "NINE_ROUTER_FETCH_CONNECT_TIMEOUT_MS";

const importFresh = async () => {
  vi.resetModules();
  return import("../../open-sse/config/runtimeConfig.js");
};

describe("runtimeConfig env overrides", () => {
  let warnSpy;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("uses the env value when NINE_ROUTER_STREAM_STALL_TIMEOUT_MS is set", async () => {
    vi.stubEnv(STALL_ENV, "60000");
    const mod = await importFresh();
    expect(mod.STREAM_STALL_TIMEOUT_MS).toBe(60000);
  });

  it("uses the env value when NINE_ROUTER_FETCH_CONNECT_TIMEOUT_MS is set", async () => {
    vi.stubEnv(FETCH_ENV, "45000");
    const mod = await importFresh();
    expect(mod.FETCH_CONNECT_TIMEOUT_MS).toBe(45000);
  });

  it("falls back to 30000ms for stream stall when no env is set", async () => {
    const mod = await importFresh();
    expect(mod.STREAM_STALL_TIMEOUT_MS).toBe(30000);
  });

  it("falls back to 20000ms for fetch connect when no env is set", async () => {
    const mod = await importFresh();
    expect(mod.FETCH_CONNECT_TIMEOUT_MS).toBe(20000);
  });

  it("trims surrounding whitespace from a valid env value", async () => {
    vi.stubEnv(STALL_ENV, "  90000  ");
    const mod = await importFresh();
    expect(mod.STREAM_STALL_TIMEOUT_MS).toBe(90000);
  });

  it("warns and falls back when env value is non-numeric", async () => {
    vi.stubEnv(STALL_ENV, "30s");
    const mod = await importFresh();
    expect(mod.STREAM_STALL_TIMEOUT_MS).toBe(30000);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`Invalid ${STALL_ENV}="30s"`)
    );
  });

  it("warns and falls back when env value is zero", async () => {
    vi.stubEnv(FETCH_ENV, "0");
    const mod = await importFresh();
    expect(mod.FETCH_CONNECT_TIMEOUT_MS).toBe(20000);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`Invalid ${FETCH_ENV}="0"`)
    );
  });

  it("warns and falls back when env value is negative", async () => {
    vi.stubEnv(STALL_ENV, "-5");
    const mod = await importFresh();
    expect(mod.STREAM_STALL_TIMEOUT_MS).toBe(30000);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`Invalid ${STALL_ENV}="-5"`)
    );
  });

  it("warns and falls back for partial-numeric values like '60abc'", async () => {
    vi.stubEnv(STALL_ENV, "60abc");
    const mod = await importFresh();
    expect(mod.STREAM_STALL_TIMEOUT_MS).toBe(30000);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`Invalid ${STALL_ENV}="60abc"`)
    );
  });

  it("does not warn when the env var is unset", async () => {
    const mod = await importFresh();
    expect(mod.STREAM_STALL_TIMEOUT_MS).toBe(30000);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});