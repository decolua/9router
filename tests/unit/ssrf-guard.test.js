import { describe, it, expect } from "vitest";
import {
  isSafeFetchUrl,
  assertSafeFetchUrl,
  isBlockedHostname,
} from "../../open-sse/utils/ssrfGuard.js";

describe("ssrfGuard", () => {
  it("allows public https URLs", () => {
    expect(isSafeFetchUrl("https://example.com/image.png")).toBe(true);
  });

  it("blocks localhost and private IPs", () => {
    expect(isBlockedHostname("localhost")).toBe(true);
    expect(isBlockedHostname("127.0.0.1")).toBe(true);
    expect(isBlockedHostname("10.0.0.1")).toBe(true);
    expect(isBlockedHostname("192.168.1.1")).toBe(true);
    expect(isBlockedHostname("169.254.169.254")).toBe(true);
    expect(isSafeFetchUrl("http://127.0.0.1/secret")).toBe(false);
    expect(isSafeFetchUrl("https://metadata.google.internal/computeMetadata/v1/")).toBe(false);
  });

  it("rejects URLs with embedded credentials", () => {
    expect(() => assertSafeFetchUrl("https://user:pass@example.com")).toThrow();
  });
});
