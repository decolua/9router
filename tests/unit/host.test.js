import { describe, it, expect } from "vitest";
import { normalizeHostHeaderHostname } from "../../src/shared/utils/host.js";

describe("normalizeHostHeaderHostname", () => {
  it("normalizes host headers with ports", () => {
    expect(normalizeHostHeaderHostname("localhost:20128")).toBe("localhost");
    expect(normalizeHostHeaderHostname("127.0.0.1:20128")).toBe("127.0.0.1");
  });

  it("normalizes IPv6 loopback forms", () => {
    expect(normalizeHostHeaderHostname("[::1]:20128")).toBe("::1");
    expect(normalizeHostHeaderHostname("::1")).toBe("::1");
  });

  it("rejects malformed bracketed hosts", () => {
    expect(normalizeHostHeaderHostname("[::1")).toBe("");
  });
});
