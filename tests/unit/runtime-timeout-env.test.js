// Tests for configurable upstream timeouts via env vars
// Covers STREAM_STALL_TIMEOUT_MS and FETCH_CONNECT_TIMEOUT_MS in runtimeConfig.js
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const CONFIG_PATH = "../../open-sse/config/runtimeConfig.js";

describe("runtimeConfig upstream timeout env overrides", () => {
  const original = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.STREAM_STALL_TIMEOUT_MS;
    delete process.env.FETCH_CONNECT_TIMEOUT_MS;
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("falls back to defaults when env vars are unset", async () => {
    const cfg = await import(CONFIG_PATH);
    expect(cfg.STREAM_STALL_TIMEOUT_MS).toBe(30000);
    expect(cfg.FETCH_CONNECT_TIMEOUT_MS).toBe(20000);
  });

  it("reads overrides from env vars", async () => {
    process.env.STREAM_STALL_TIMEOUT_MS = "120000";
    process.env.FETCH_CONNECT_TIMEOUT_MS = "60000";
    const cfg = await import(CONFIG_PATH);
    expect(cfg.STREAM_STALL_TIMEOUT_MS).toBe(120000);
    expect(cfg.FETCH_CONNECT_TIMEOUT_MS).toBe(60000);
  });
});
