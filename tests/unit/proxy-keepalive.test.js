import { describe, it, expect, beforeEach } from "vitest";

import {
  DIRECT_KEEP_ALIVE_TIMEOUT_MS,
  DIRECT_KEEP_ALIVE_MAX_TIMEOUT_MS,
  getDirectDispatcher,
  resetDirectDispatcherForTests,
  isStaleSocketError,
} from "../../open-sse/utils/proxyFetch.js";

beforeEach(() => {
  resetDirectDispatcherForTests();
});

describe("stale keep-alive protection", () => {
  it("caps pooled socket lifetime below edge idle timeouts", () => {
    // Cloudflare closes idle connections first; our pool must never
    // outlive the server window or reuse turns into hangs.
    expect(DIRECT_KEEP_ALIVE_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
    expect(DIRECT_KEEP_ALIVE_MAX_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
  });

  it("reuses a single shared direct dispatcher", async () => {
    const first = await getDirectDispatcher();
    const second = await getDirectDispatcher();
    expect(first).not.toBeNull();
    expect(second).toBe(first);
  });

  it("classifies dead-socket errors, not host errors", () => {
    expect(isStaleSocketError(Object.assign(new Error("x"), { cause: { code: "UND_ERR_SOCKET" } }))).toBe(true);
    expect(isStaleSocketError(Object.assign(new Error("x"), { cause: { code: "ECONNRESET" } }))).toBe(true);
    expect(isStaleSocketError(Object.assign(new Error("x"), { cause: { code: "EPIPE" } }))).toBe(true);
    expect(isStaleSocketError(Object.assign(new Error("timeout"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }))).toBe(false);
    expect(isStaleSocketError(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(false);
    expect(isStaleSocketError(new Error("plain"))).toBe(false);
    expect(isStaleSocketError(null)).toBe(false);
  });
});
