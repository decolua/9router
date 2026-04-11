import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("IP allowlist helpers", () => {
  const originalEnabled = process.env.IP_ALLOWLIST_ENABLED;
  const originalAllowlist = process.env.IP_ALLOWLIST;

  beforeEach(() => {
    delete process.env.IP_ALLOWLIST_ENABLED;
    delete process.env.IP_ALLOWLIST;
  });

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.IP_ALLOWLIST_ENABLED;
    else process.env.IP_ALLOWLIST_ENABLED = originalEnabled;

    if (originalAllowlist === undefined) delete process.env.IP_ALLOWLIST;
    else process.env.IP_ALLOWLIST = originalAllowlist;
  });

  it("extracts the first client ip from x-forwarded-for", async () => {
    const { getClientIpFromHeaders } = await import("../../src/lib/ipAllowlist.js");

    const headers = new Headers({
      "x-forwarded-for": "203.0.113.10, 10.0.0.2",
    });

    expect(getClientIpFromHeaders(headers)).toBe("203.0.113.10");
  });

  it("allows exact ips and cidr ranges from config", async () => {
    process.env.IP_ALLOWLIST_ENABLED = "true";
    process.env.IP_ALLOWLIST = "203.0.113.10,198.51.100.0/24";

    const { evaluateIpAllowlist } = await import("../../src/lib/ipAllowlist.js");

    const request = {
      headers: new Headers({
        host: "app.example.com",
        "x-forwarded-for": "198.51.100.42",
      }),
      nextUrl: { pathname: "/v1/responses" },
    };

    expect(evaluateIpAllowlist(request)).toEqual({
      allowed: true,
      enabled: true,
      clientIp: "198.51.100.42",
      reason: "allowlist_match",
    });
  });

  it("allows loopback requests for internal self-calls", async () => {
    process.env.IP_ALLOWLIST_ENABLED = "true";
    process.env.IP_ALLOWLIST = "203.0.113.10";

    const { evaluateIpAllowlist } = await import("../../src/lib/ipAllowlist.js");

    const request = {
      headers: new Headers({
        host: "127.0.0.1:20128",
      }),
      nextUrl: { pathname: "/api/settings/require-login" },
    };

    expect(evaluateIpAllowlist(request)).toEqual({
      allowed: true,
      enabled: true,
      clientIp: "127.0.0.1",
      reason: "loopback",
    });
  });

  it("fails loudly when enabled but no allowlist is configured", async () => {
    process.env.IP_ALLOWLIST_ENABLED = "true";

    const { evaluateIpAllowlist } = await import("../../src/lib/ipAllowlist.js");

    expect(() => evaluateIpAllowlist({
      headers: new Headers({ host: "app.example.com" }),
      nextUrl: { pathname: "/" },
    })).toThrow(/IP_ALLOWLIST/);
  });
});
