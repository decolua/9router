import { describe, it, expect } from "vitest";
import zlib from "node:zlib";

describe("Issue #5539 - Node 20 Undici zstd Compatibility", () => {
  it("should ensure createZstdDecompress is at least a callable function or stub", () => {
    expect(typeof zlib.createZstdDecompress).toBe("function");
  });

  it("should safely import undici without throwing 'reading bind' TypeError", async () => {
    await expect(import("undici")).resolves.toBeDefined();
  });

  it("should sanitize Accept-Encoding headers on runtimes lacking native zstd", async () => {
    const { sanitizeAcceptEncoding, isNativeZstdSupported } = await import("../../open-sse/utils/zstdCompat.js");

    const plainHeaders = { "Accept-Encoding": "gzip, deflate, br, zstd" };
    sanitizeAcceptEncoding(plainHeaders);

    if (!isNativeZstdSupported) {
      expect(plainHeaders["Accept-Encoding"]).toBe("gzip, deflate, br");
      expect(plainHeaders["Accept-Encoding"]).not.toContain("zstd");
    }

    const webHeaders = new Headers({ "accept-encoding": "gzip, deflate, br, zstd" });
    sanitizeAcceptEncoding(webHeaders);

    if (!isNativeZstdSupported) {
      expect(webHeaders.get("accept-encoding")).toBe("gzip, deflate, br");
      expect(webHeaders.get("accept-encoding")).not.toContain("zstd");
    }
  });

  it("should throw descriptive error if stub is called directly", async () => {
    const { isNativeZstdSupported } = await import("../../open-sse/utils/zstdCompat.js");
    if (!isNativeZstdSupported) {
      expect(() => zlib.createZstdDecompress()).toThrow(/Node\.js <22\.15\.0/);
    }
  });
});
