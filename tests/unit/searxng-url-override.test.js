/**
 * Tests for issue #1932 — SearXNG configurable base URL override.
 *
 * Coverage:
 *  1. validateSearxngBaseUrl guard — valid URLs, blocked schemes/hosts
 *  2. resolveBaseUrl — uses persisted providerOptions/providerSpecificData.baseUrl
 *  3. buildSearxngRequest — custom baseUrl produces the correct search URL
 *  4. normalizeProviderSpecificData — SearXNG branch stores baseUrl
 */

import { describe, it, expect } from "vitest";
import { validateSearxngBaseUrl } from "../../open-sse/handlers/search/searxngUrlGuard.js";
import {
  resolveBaseUrl,
  getProviderSetting,
  buildSearchRequest,
} from "../../open-sse/handlers/search/callers.js";
import { normalizeProviderSpecificData } from "../../src/lib/providerNormalization.js";

// ---------------------------------------------------------------------------
// 1. validateSearxngBaseUrl — guard tests
// ---------------------------------------------------------------------------

describe("validateSearxngBaseUrl — valid URLs", () => {
  it("accepts http://localhost:8888", () => {
    const r = validateSearxngBaseUrl("http://localhost:8888");
    expect(r.ok).toBe(true);
    expect(r.url).toBeInstanceOf(URL);
  });

  it("accepts http://127.0.0.1:8888", () => {
    expect(validateSearxngBaseUrl("http://127.0.0.1:8888").ok).toBe(true);
  });

  it("accepts http://[::1]:8888 (IPv6 loopback)", () => {
    expect(validateSearxngBaseUrl("http://[::1]:8888").ok).toBe(true);
  });

  it("accepts private LAN IP (intentional self-hosting)", () => {
    expect(validateSearxngBaseUrl("http://192.168.1.50:8080").ok).toBe(true);
  });

  it("accepts RFC-1918 10.x range", () => {
    expect(validateSearxngBaseUrl("http://10.0.0.5:8888").ok).toBe(true);
  });

  it("accepts RFC-1918 172.16.x range", () => {
    expect(validateSearxngBaseUrl("http://172.16.5.10:8888").ok).toBe(true);
  });

  it("accepts https:// with public hostname", () => {
    expect(validateSearxngBaseUrl("https://search.example.com").ok).toBe(true);
  });

  it("accepts URL with trailing path", () => {
    const r = validateSearxngBaseUrl("http://localhost:8080/searxng");
    expect(r.ok).toBe(true);
  });

  it("strips leading/trailing whitespace before parsing", () => {
    const r = validateSearxngBaseUrl("  http://localhost:8888  ");
    expect(r.ok).toBe(true);
  });
});

describe("validateSearxngBaseUrl — blocked inputs", () => {
  it("rejects null", () => {
    expect(validateSearxngBaseUrl(null).ok).toBe(false);
    expect(validateSearxngBaseUrl(null).error).toBeTruthy();
  });

  it("rejects undefined", () => {
    expect(validateSearxngBaseUrl(undefined).ok).toBe(false);
  });

  it("rejects empty string", () => {
    expect(validateSearxngBaseUrl("").ok).toBe(false);
  });

  it("rejects whitespace-only string", () => {
    expect(validateSearxngBaseUrl("   ").ok).toBe(false);
  });

  it("rejects unparseable URL", () => {
    const r = validateSearxngBaseUrl("not-a-url");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("Invalid URL");
  });

  it("rejects file:// scheme", () => {
    const r = validateSearxngBaseUrl("file:///etc/passwd");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("not allowed");
  });

  it("rejects javascript: scheme", () => {
    expect(validateSearxngBaseUrl("javascript:alert(1)").ok).toBe(false);
  });

  it("rejects gopher:// scheme", () => {
    expect(validateSearxngBaseUrl("gopher://localhost:6379/").ok).toBe(false);
  });

  it("rejects ftp:// scheme", () => {
    expect(validateSearxngBaseUrl("ftp://files.example.com").ok).toBe(false);
  });

  it("rejects AWS IMDS endpoint 169.254.169.254", () => {
    const r = validateSearxngBaseUrl("http://169.254.169.254/latest/meta-data/");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("metadata");
  });

  it("rejects Alibaba Cloud metadata 100.100.100.200", () => {
    const r = validateSearxngBaseUrl("http://100.100.100.200/");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("metadata");
  });

  it("rejects IPv6 link-local fe80::", () => {
    const r = validateSearxngBaseUrl("http://[fe80::1]/");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("link-local");
  });

  // F-3: IPv6-mapped IPv4 IMDS bypass (::ffff:<v4> routes to IPv4 on dual-stack hosts)
  it("rejects IPv6-mapped IMDS address http://[::ffff:169.254.169.254]/", () => {
    // Node URL API normalises ::ffff:169.254.169.254 → ::ffff:a9fe:a9fe
    const r = validateSearxngBaseUrl("http://[::ffff:169.254.169.254]/");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("blocked");
  });

  it("rejects IPv6-mapped IMDS in URL-normalised hex form http://[::ffff:a9fe:a9fe]/", () => {
    const r = validateSearxngBaseUrl("http://[::ffff:a9fe:a9fe]/");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("blocked");
  });

  it("rejects IPv6-mapped Alibaba Cloud metadata http://[::ffff:6464:64c8]/", () => {
    // ::ffff:6464:64c8 decodes to 100.100.100.200
    const r = validateSearxngBaseUrl("http://[::ffff:6464:64c8]/");
    expect(r.ok).toBe(false);
    expect(r.error).toContain("blocked");
  });

  // F-4 / DNS-alias note: hostname-based metadata aliases are not blocked by
  // static analysis (known limitation, documented in guard comments).
  it("allows metadata.google.internal (hostname alias; DNS-level limitation is documented)", () => {
    const r = validateSearxngBaseUrl("http://metadata.google.internal/");
    // Static guard cannot resolve DNS — this is an accepted known limitation.
    expect(r.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. resolveBaseUrl — picks up override from providerOptions / providerSpecificData
// ---------------------------------------------------------------------------

const SEARXNG_REGISTRY_CONFIG = {
  id: "searxng",
  baseUrl: "http://localhost:8888/search",
  method: "GET",
};

describe("resolveBaseUrl — SearXNG override resolution", () => {
  it("returns registry default when no override is present", () => {
    const params = { query: "test", searchType: "web", maxResults: 5 };
    const base = resolveBaseUrl(SEARXNG_REGISTRY_CONFIG, params);
    // resolveBaseUrl strips trailing slash; /search doesn't end with /
    expect(base).toBe("http://localhost:8888/search");
  });

  it("uses providerOptions.baseUrl over registry default", () => {
    const params = {
      query: "test",
      searchType: "web",
      maxResults: 5,
      providerOptions: { baseUrl: "http://192.168.1.10:8080" },
    };
    const base = resolveBaseUrl(SEARXNG_REGISTRY_CONFIG, params);
    expect(base).toBe("http://192.168.1.10:8080");
  });

  it("uses providerSpecificData.baseUrl over registry default", () => {
    const params = {
      query: "test",
      searchType: "web",
      maxResults: 5,
      providerSpecificData: { baseUrl: "https://search.example.com" },
    };
    const base = resolveBaseUrl(SEARXNG_REGISTRY_CONFIG, params);
    expect(base).toBe("https://search.example.com");
  });

  it("providerOptions.baseUrl takes priority over providerSpecificData.baseUrl", () => {
    const params = {
      query: "test",
      searchType: "web",
      maxResults: 5,
      providerOptions: { baseUrl: "http://10.0.0.5:8888" },
      providerSpecificData: { baseUrl: "http://192.168.1.10:8080" },
    };
    const base = resolveBaseUrl(SEARXNG_REGISTRY_CONFIG, params);
    expect(base).toBe("http://10.0.0.5:8888");
  });

  it("strips trailing slash from override", () => {
    const params = {
      query: "test",
      searchType: "web",
      maxResults: 5,
      providerOptions: { baseUrl: "http://localhost:8888/" },
    };
    const base = resolveBaseUrl(SEARXNG_REGISTRY_CONFIG, params);
    expect(base).toBe("http://localhost:8888");
  });
});

// ---------------------------------------------------------------------------
// 3. buildSearxngRequest — correct URL is built with a custom baseUrl
// ---------------------------------------------------------------------------

describe("buildSearxngRequest — custom baseUrl integration", () => {
  it("appends /search when custom baseUrl does not include it", () => {
    const params = {
      query: "vitest",
      searchType: "web",
      maxResults: 5,
      providerOptions: { baseUrl: "http://192.168.1.10:8080" },
    };
    const { url } = buildSearchRequest({ id: "searxng", ...SEARXNG_REGISTRY_CONFIG }, params);
    expect(url).toContain("http://192.168.1.10:8080/search?");
    expect(url).toContain("q=vitest");
    expect(url).toContain("format=json");
  });

  it("does not double-append /search when baseUrl already ends with /search", () => {
    const params = {
      query: "hello",
      searchType: "web",
      maxResults: 5,
      providerOptions: { baseUrl: "http://192.168.1.10:8080/search" },
    };
    const { url } = buildSearchRequest({ id: "searxng", ...SEARXNG_REGISTRY_CONFIG }, params);
    expect(url).not.toContain("/search/search");
    expect(url).toContain("http://192.168.1.10:8080/search?");
  });

  it("falls back to registry default when no override is provided", () => {
    const params = {
      query: "hello",
      searchType: "web",
      maxResults: 5,
    };
    const { url } = buildSearchRequest({ id: "searxng", ...SEARXNG_REGISTRY_CONFIG }, params);
    // Default is http://localhost:8888/search — already ends with /search
    expect(url).toContain("http://localhost:8888/search?");
  });

  it("builds a news search URL correctly with custom baseUrl", () => {
    const params = {
      query: "AI news",
      searchType: "news",
      maxResults: 5,
      providerOptions: { baseUrl: "https://search.example.com" },
    };
    const { url } = buildSearchRequest({ id: "searxng", ...SEARXNG_REGISTRY_CONFIG }, params);
    expect(url).toContain("https://search.example.com/search?");
    expect(url).toContain("categories=news");
    expect(url).toContain("q=AI+news");
  });

  it("uses GET method with Accept: application/json header", () => {
    const params = {
      query: "test",
      searchType: "web",
      maxResults: 5,
      providerOptions: { baseUrl: "http://localhost:8080" },
    };
    const { init } = buildSearchRequest({ id: "searxng", ...SEARXNG_REGISTRY_CONFIG }, params);
    expect(init.method).toBe("GET");
    expect(init.headers?.Accept).toBe("application/json");
  });
});

// ---------------------------------------------------------------------------
// 4. normalizeProviderSpecificData — SearXNG branch stores baseUrl
// ---------------------------------------------------------------------------

describe("normalizeProviderSpecificData — SearXNG", () => {
  it("extracts baseUrl from providerSpecificData object", () => {
    const result = normalizeProviderSpecificData(
      "searxng",
      {},
      { baseUrl: "http://192.168.1.50:8080" }
    );
    expect(result.baseUrl).toBe("http://192.168.1.50:8080");
  });

  it("extracts baseUrl from body.baseUrl", () => {
    const result = normalizeProviderSpecificData(
      "searxng",
      { baseUrl: "http://10.0.0.5:8888" },
      null
    );
    expect(result.baseUrl).toBe("http://10.0.0.5:8888");
  });

  it("extracts baseUrl from body.searxngBaseUrl", () => {
    const result = normalizeProviderSpecificData(
      "searxng",
      { searxngBaseUrl: "https://search.example.com" },
      null
    );
    expect(result.baseUrl).toBe("https://search.example.com");
  });

  it("providerSpecificData.baseUrl takes priority over body.baseUrl", () => {
    const result = normalizeProviderSpecificData(
      "searxng",
      { baseUrl: "http://body-url.com" },
      { baseUrl: "http://specific-url.com" }
    );
    expect(result.baseUrl).toBe("http://specific-url.com");
  });

  it("returns null when no baseUrl is provided for searxng", () => {
    const result = normalizeProviderSpecificData("searxng", {}, null);
    expect(result).toBeNull();
  });

  it("trims whitespace from baseUrl", () => {
    const result = normalizeProviderSpecificData(
      "searxng",
      { searxngBaseUrl: "  http://localhost:8888  " },
      null
    );
    expect(result.baseUrl).toBe("http://localhost:8888");
  });

  it("does not affect other providers", () => {
    const result = normalizeProviderSpecificData(
      "brave-search",
      { searxngBaseUrl: "http://should-be-ignored.com" },
      null
    );
    // brave-search has no special handling, so result is null (no known keys)
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 5. getProviderSetting helper — reads from both providerOptions and providerSpecificData
// ---------------------------------------------------------------------------

describe("getProviderSetting — baseUrl lookup", () => {
  it("reads baseUrl from providerOptions", () => {
    const params = {
      providerOptions: { baseUrl: "http://from-options.com" },
    };
    expect(getProviderSetting(params, "baseUrl")).toBe("http://from-options.com");
  });

  it("reads baseUrl from providerSpecificData when providerOptions is absent", () => {
    const params = {
      providerSpecificData: { baseUrl: "http://from-specific.com" },
    };
    expect(getProviderSetting(params, "baseUrl")).toBe("http://from-specific.com");
  });

  it("returns undefined when neither source has the key", () => {
    expect(getProviderSetting({}, "baseUrl")).toBeUndefined();
  });

  it("ignores empty string values", () => {
    const params = {
      providerOptions: { baseUrl: "   " },
      providerSpecificData: { baseUrl: "http://from-specific.com" },
    };
    // providerOptions has whitespace-only value → should fall through to providerSpecificData
    expect(getProviderSetting(params, "baseUrl")).toBe("http://from-specific.com");
  });
});
