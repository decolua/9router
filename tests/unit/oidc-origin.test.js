import { afterEach, describe, expect, it } from "vitest";
import { getPublicOrigin } from "../../src/lib/auth/oidc.js";

function request(url, headers = {}) {
  return {
    url,
    headers: {
      get(name) {
        return headers[name.toLowerCase()] || null;
      },
    },
  };
}

describe("getPublicOrigin", () => {
  afterEach(() => {
    delete process.env.BASE_URL;
    delete process.env.NEXT_PUBLIC_BASE_URL;
    delete process.env.TRUST_PROXY_HEADERS;
  });

  it("prefers configured base url", () => {
    process.env.BASE_URL = "https://router.example.com/";

    expect(getPublicOrigin(request("http://localhost:20128/api/auth/oidc/start"))).toBe("https://router.example.com");
  });

  it("ignores forwarded host unless proxy headers are trusted", () => {
    const req = request("http://localhost:20128/api/auth/oidc/start", {
      host: "localhost:20128",
      "x-forwarded-host": "evil.example",
      "x-forwarded-proto": "https",
    });

    expect(getPublicOrigin(req)).toBe("http://localhost:20128");
  });

  it("uses forwarded host only when explicitly trusted", () => {
    process.env.TRUST_PROXY_HEADERS = "true";
    const req = request("http://localhost:20128/api/auth/oidc/start", {
      host: "localhost:20128",
      "x-forwarded-host": "router.example.com",
      "x-forwarded-proto": "https",
    });

    expect(getPublicOrigin(req)).toBe("https://router.example.com");
  });
});
