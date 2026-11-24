/**
 * Unit tests for validateEnterpriseDomain (QwenWork enterprise sign-in).
 *
 * The function is an input-contract check for the enterprise domain prompt:
 * a bare multi-label domain, or an https:// address with no path, port,
 * credentials, query or hash. It normalizes case and returns the bare
 * hostname; anything else names no enterprise domain. These lock every
 * rejection branch so a regression cannot shape an arbitrary URL or a
 * loopback/intranet-looking host into the enterprise base URL:
 *   - happy path: bare host, https:// host, trailing slash, case folding
 *   - scheme/component rejection: http, port, path, query, hash, userinfo
 *     (including the https://a.com@evil.com confusion form)
 *   - URL parse failure
 *   - host-shape rejection: bare IPv4, https:// IPv4, localhost family,
 *     intranet suffixes, trailing dot, single-label, empty/whitespace,
 *     bad leading char, empty label
 */

import { describe, it, expect } from "vitest";

import { validateEnterpriseDomain } from "../../open-sse/shared/qoder/enterpriseDomain.js";

describe("validateEnterpriseDomain accepts", () => {
  it("takes a bare enterprise host", () => {
    expect(validateEnterpriseDomain("your-company.vpc.qwenwork.cn")).toBe(
      "your-company.vpc.qwenwork.cn",
    );
  });

  it("takes an https:// host with no path", () => {
    expect(validateEnterpriseDomain("https://your-company.vpc.qwenwork.cn")).toBe(
      "your-company.vpc.qwenwork.cn",
    );
  });

  it("takes an https:// host with a trailing slash", () => {
    expect(validateEnterpriseDomain("https://a.example.com/")).toBe("a.example.com");
  });

  it("normalizes case and trims surrounding whitespace", () => {
    expect(validateEnterpriseDomain("  A.Example.COM  ")).toBe("a.example.com");
  });
});

describe("validateEnterpriseDomain rejects", () => {
  const rejects = [
    // wrong scheme
    "http://a.com",
    // port
    "https://a.com:8443",
    // path
    "https://a.com/path",
    // query
    "https://a.com?q=1",
    // fragment
    "https://a.com#f",
    // userinfo
    "https://user@a.com",
    // confusion: hostname is evil.com, not a.com
    "https://a.com@evil.com",
    // unparseable URL
    "https://",
    // bare IPv4
    "192.168.1.1",
    // https:// IPv4 host
    "https://10.0.0.1",
    // loopback family
    "localhost",
    "foo.localhost",
    "foo.local",
    "foo.internal",
    // trailing dot (the host regex ends in [a-z]{2,}$)
    "a.com.",
    // single label
    "com",
    // empty and whitespace-only
    "",
    "  ",
    // bad leading character
    "-a.com",
    // empty label
    "a..com",
  ];

  it.each(rejects)("rejects %s", (input) => {
    expect(validateEnterpriseDomain(input)).toBeNull();
  });

  it("rejects non-string-ish null and undefined input", () => {
    expect(validateEnterpriseDomain(null)).toBeNull();
    expect(validateEnterpriseDomain(undefined)).toBeNull();
  });
});
