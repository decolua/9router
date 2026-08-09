// Issue #3049 — residual SSRF via provider_options.baseUrl in /v1/search.
// resolveBaseUrl() must reject client-controlled internal/private URLs.

import { describe, it, expect } from "vitest";
import { resolveBaseUrl } from "../../open-sse/handlers/search/callers.js";

const publicConfig = { id: "searxng", baseUrl: "https://searxng.example.com" };
const internalConfig = { id: "searxng", baseUrl: "http://127.0.0.1:18999" };

describe("resolveBaseUrl SSRF guard (#3049)", () => {
  it("allows a public admin-configured baseUrl", () => {
    expect(resolveBaseUrl(publicConfig, {})).toBe("https://searxng.example.com");
  });

  it("rejects client override pointing to loopback IPv4", () => {
    expect(() =>
      resolveBaseUrl(publicConfig, { providerOptions: { baseUrl: "http://127.0.0.1:18999" } })
    ).toThrow(/SSRF guard/);
  });

  it("rejects client override pointing to 169.254.169.254 (cloud metadata)", () => {
    expect(() =>
      resolveBaseUrl(publicConfig, { providerOptions: { baseUrl: "http://169.254.169.254/latest/meta-data" } })
    ).toThrow(/SSRF guard/);
  });

  it("rejects client override pointing to RFC1918 10.x", () => {
    expect(() =>
      resolveBaseUrl(publicConfig, { providerOptions: { baseUrl: "http://10.0.0.5:8080" } })
    ).toThrow(/SSRF guard/);
  });

  it("rejects client override pointing to RFC1918 192.168.x", () => {
    expect(() =>
      resolveBaseUrl(publicConfig, { providerOptions: { baseUrl: "http://192.168.1.1" } })
    ).toThrow(/SSRF guard/);
  });

  it("rejects client override pointing to localhost hostname", () => {
    expect(() =>
      resolveBaseUrl(publicConfig, { providerOptions: { baseUrl: "http://localhost:9090" } })
    ).toThrow(/SSRF guard/);
  });

  it("rejects internal admin-configured baseUrl too (defense in depth)", () => {
    expect(() => resolveBaseUrl(internalConfig, {})).toThrow(/SSRF guard/);
  });

  it("strips trailing slashes on valid public URLs", () => {
    expect(resolveBaseUrl(publicConfig, { providerOptions: { baseUrl: "https://public.example.org/" } })).toBe(
      "https://public.example.org"
    );
  });
});
