import { afterEach, describe, expect, it } from "vitest";

import { isHttp2DisabledForUrl, isStaleSocketError } from "../../open-sse/utils/proxyFetch.js";

// amr-link.open-design.ai resets a multiplexed HTTP/2 session under concurrent load
// (RST_STREAM ENHANCE_YOUR_CALM / PROTOCOL_ERROR). Verified 2026-11-11: the same key that
// failed through 9router succeeded on a single fresh connection.

const ENV = "NINEROUTER_HTTP2_DISABLED_HOSTS";
const saved = process.env[ENV];
afterEach(() => {
  if (saved === undefined) delete process.env[ENV];
  else process.env[ENV] = saved;
});

describe("HTTP/2 edge reset handling", () => {
  it("pins OpenDesign to HTTP/1.1 by default", () => {
    delete process.env[ENV];
    expect(isHttp2DisabledForUrl("https://amr-link.open-design.ai/v1/messages")).toBe(true);
    expect(isHttp2DisabledForUrl("https://api.anthropic.com/v1/messages")).toBe(false);
  });

  it("lets env replace, extend to every host, or opt out", () => {
    process.env[ENV] = "example.com";
    expect(isHttp2DisabledForUrl("https://api.example.com/v1")).toBe(true);
    expect(isHttp2DisabledForUrl("https://amr-link.open-design.ai/v1")).toBe(false);
    process.env[ENV] = "*";
    expect(isHttp2DisabledForUrl("https://anything.test/")).toBe(true);
    process.env[ENV] = "none";
    expect(isHttp2DisabledForUrl("https://amr-link.open-design.ai/v1")).toBe(false);
    expect(isHttp2DisabledForUrl("not a url")).toBe(false);
  });

  it("treats a reset HTTP/2 stream as replayable on a fresh socket", () => {
    const h2 = (code, message) => Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(message), { code }) });
    expect(isStaleSocketError(h2("ERR_HTTP2_STREAM_ERROR", "Stream closed with error code NGHTTP2_ENHANCE_YOUR_CALM"))).toBe(true);
    expect(isStaleSocketError(h2("ERR_HTTP2_STREAM_ERROR", "Stream closed with error code NGHTTP2_PROTOCOL_ERROR"))).toBe(true);
    expect(isStaleSocketError(h2(undefined, "Stream closed with error code NGHTTP2_REFUSED_STREAM"))).toBe(true);
    // Unreachable hosts are still not mistaken for stale sockets.
    expect(isStaleSocketError(h2("UND_ERR_CONNECT_TIMEOUT", "Connect Timeout Error"))).toBe(false);
    expect(isStaleSocketError(h2("ENOTFOUND", "getaddrinfo ENOTFOUND"))).toBe(false);
  });
});
