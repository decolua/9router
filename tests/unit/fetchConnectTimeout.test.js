import { describe, it, expect } from "vitest";
import {
  FETCH_CONNECT_TIMEOUT_MS,
  ANTHROPIC_COMPATIBLE_FETCH_CONNECT_TIMEOUT_MS,
  FETCH_CONNECT_TIMEOUT_MAX_MS,
  resolveFetchConnectTimeoutMs,
} from "../../open-sse/config/runtimeConfig.js";

describe("resolveFetchConnectTimeoutMs", () => {
  it("uses the global default for normal providers", () => {
    expect(resolveFetchConnectTimeoutMs("openai", {}, null)).toBe(FETCH_CONNECT_TIMEOUT_MS);
  });

  it("uses the longer default for anthropic-compatible custom providers", () => {
    expect(resolveFetchConnectTimeoutMs("anthropic-compatible-abc", {}, null)).toBe(ANTHROPIC_COMPATIBLE_FETCH_CONNECT_TIMEOUT_MS);
  });

  it("honors connection-level override", () => {
    const timeout = resolveFetchConnectTimeoutMs("anthropic-compatible-abc", {}, {
      providerSpecificData: { fetchConnectTimeoutMs: 12345 },
    });
    expect(timeout).toBe(12345);
  });

  it("caps connection-level override", () => {
    const timeout = resolveFetchConnectTimeoutMs("anthropic-compatible-abc", {}, {
      providerSpecificData: { fetchConnectTimeoutMs: FETCH_CONNECT_TIMEOUT_MAX_MS * 2 },
    });
    expect(timeout).toBe(FETCH_CONNECT_TIMEOUT_MAX_MS);
  });
});
