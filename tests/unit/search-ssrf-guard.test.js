import { describe, it, expect } from "vitest";
import { resolveBaseUrl } from "../../open-sse/handlers/search/callers.js";

const CONFIG = { id: "searxng", baseUrl: "https://searxng.example.com" };

describe("resolveBaseUrl SSRF guard", () => {
  it("uses provider default when no override", () => {
    expect(resolveBaseUrl(CONFIG, {})).toBe("https://searxng.example.com");
  });

  it("allows public https override", () => {
    const params = { providerOptions: { baseUrl: "https://my-searxng.example.com" } };
    expect(resolveBaseUrl(CONFIG, params)).toBe("https://my-searxng.example.com");
  });

  it("allows public http override", () => {
    const params = { providerOptions: { baseUrl: "http://searxng.example.net" } };
    expect(resolveBaseUrl(CONFIG, params)).toBe("http://searxng.example.net");
  });

  it("allows a credentialed override only on the configured provider origin", () => {
    const config = { id: "serper", baseUrl: "https://google.serper.dev/search" };
    expect(resolveBaseUrl(config, {
      token: "server-held-secret",
      providerOptions: { baseUrl: "https://google.serper.dev/custom-path" },
    })).toBe("https://google.serper.dev/custom-path");

    expect(() => resolveBaseUrl(config, {
      token: "server-held-secret",
      providerOptions: { baseUrl: "https://attacker.example/collect" },
    })).toThrow(/must use the configured origin/);
  });

  it("still allows public endpoint overrides for providers without credentials", () => {
    const params = { providerOptions: { baseUrl: "https://my-public-search.example" } };
    expect(resolveBaseUrl(CONFIG, params)).toBe("https://my-public-search.example");
  });

  it("rejects loopback override", () => {
    const params = { providerOptions: { baseUrl: "http://127.0.0.1:18999" } };
    expect(() => resolveBaseUrl(CONFIG, params)).toThrow();
  });

  it("rejects private IP override", () => {
    for (const ip of ["10.0.0.1", "192.168.1.1", "172.16.0.1"]) {
      const params = { providerOptions: { baseUrl: `http://${ip}` } };
      expect(() => resolveBaseUrl(CONFIG, params), `should reject ${ip}`).toThrow();
    }
  });

  it("rejects localhost hostname override", () => {
    const params = { providerOptions: { baseUrl: "http://localhost:8080" } };
    expect(() => resolveBaseUrl(CONFIG, params)).toThrow();
  });

  it("rejects cloud metadata override", () => {
    const params = { providerOptions: { baseUrl: "http://169.254.169.254/latest/meta-data" } };
    expect(() => resolveBaseUrl(CONFIG, params)).toThrow();
  });

  it("rejects non-http protocols", () => {
    for (const proto of ["file:///etc/passwd", "gopher://127.0.0.1:70", "ftp://10.0.0.1"]) {
      const params = { providerOptions: { baseUrl: proto } };
      expect(() => resolveBaseUrl(CONFIG, params), `should reject ${proto}`).toThrow();
    }
  });
});
