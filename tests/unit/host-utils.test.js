import { describe, it, expect } from "vitest";
import { normalizeHostHeaderHostname } from "../../src/shared/utils/host.js";

describe("normalizeHostHeaderHostname", () => {
  it("strips port from host header", () => {
    expect(normalizeHostHeaderHostname("localhost:20128")).toBe("localhost");
    expect(normalizeHostHeaderHostname("Router.Example.COM:443")).toBe("router.example.com");
  });

  it("handles bracketed IPv6 hosts", () => {
    expect(normalizeHostHeaderHostname("[::1]:20128")).toBe("::1");
  });

  it("returns empty string for missing host", () => {
    expect(normalizeHostHeaderHostname(null)).toBe("");
    expect(normalizeHostHeaderHostname("")).toBe("");
  });
});
