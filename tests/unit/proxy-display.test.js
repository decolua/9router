import { describe, it, expect } from "vitest";
import {
  maskProxyUrl,
  proxyHost,
  deriveProxyKind,
  kindGroupLabel,
  deriveDisplayName,
  deriveHealth,
  formatLatency,
  formatRelativeTime,
  PROXY_KIND_ORDER,
} from "@/lib/proxyDisplay";

describe("maskProxyUrl", () => {
  it("hides embedded credentials for http proxies", () => {
    const out = maskProxyUrl("http://aejzjffk:gz85433264ki@84.247.60.125:6095/");
    expect(out).toBe("http://••••@84.247.60.125:6095");
    expect(out).not.toContain("aejzjffk");
    expect(out).not.toContain("gz85433264ki");
  });

  it("keeps protocol and host:port for credential-less socks5", () => {
    expect(maskProxyUrl("socks5://185.209.29.226:1080")).toBe("socks5://185.209.29.226:1080");
  });

  it("masks https relay url without credentials unchanged host", () => {
    const out = maskProxyUrl("https://vercel-relay-abc.vercel.app");
    expect(out).toBe("https://vercel-relay-abc.vercel.app");
  });

  it("strips credentials even when URL parsing fails", () => {
    const out = maskProxyUrl("//user:pass@host:1080");
    expect(out).not.toContain("user:pass");
    expect(out).toContain("••••@");
  });

  it("returns empty string for nullish input", () => {
    expect(maskProxyUrl(null)).toBe("");
    expect(maskProxyUrl(undefined)).toBe("");
  });
});

describe("proxyHost", () => {
  it("returns host:port without credentials", () => {
    expect(proxyHost({ proxyUrl: "http://u:p@1.2.3.4:6095/" })).toBe("1.2.3.4:6095");
    expect(proxyHost({ proxyUrl: "socks5://5.6.7.8:1080" })).toBe("5.6.7.8:1080");
  });
});

describe("deriveProxyKind", () => {
  it("returns relay type from pool.type", () => {
    expect(deriveProxyKind({ type: "vercel", proxyUrl: "https://x.vercel.app" })).toBe("vercel");
    expect(deriveProxyKind({ type: "deno", proxyUrl: "https://x.deno.dev" })).toBe("deno");
  });

  it("derives socks5 from URL even when stored type is http", () => {
    expect(deriveProxyKind({ type: "http", proxyUrl: "socks5://1.2.3.4:1080" })).toBe("socks5");
  });

  it("derives http from URL protocol", () => {
    expect(deriveProxyKind({ type: "http", proxyUrl: "http://u:p@1.2.3.4:6095" })).toBe("http");
  });
});

describe("kindGroupLabel", () => {
  it("maps known kinds to labels", () => {
    expect(kindGroupLabel("socks5")).toBe("SOCKS5");
    expect(kindGroupLabel("http")).toBe("HTTP");
    expect(kindGroupLabel("vercel")).toBe("Vercel Relay");
  });
});

describe("deriveDisplayName", () => {
  it("rewrites auto-imported socks5 names", () => {
    expect(deriveDisplayName({ name: "Imported 185.209.29.226:1080", proxyUrl: "socks5://185.209.29.226:1080" }))
      .toBe("SOCKS5 · 185.209.29.226:1080");
  });

  it("rewrites auto-imported http names", () => {
    expect(deriveDisplayName({ name: "Imported 84.247.60.125:6095", proxyUrl: "http://u:p@84.247.60.125:6095" }))
      .toBe("HTTP · 84.247.60.125:6095");
  });

  it("uses relay label for relay pools with imported name", () => {
    expect(deriveDisplayName({ name: "Imported x", type: "vercel", proxyUrl: "https://x.vercel.app" }))
      .toBe("Vercel Relay");
  });

  it("preserves user-chosen names", () => {
    expect(deriveDisplayName({ name: "vercel-relay", type: "vercel", proxyUrl: "https://x.vercel.app" }))
      .toBe("vercel-relay");
    expect(deriveDisplayName({ name: "My Home Proxy", proxyUrl: "socks5://1.2.3.4:1080" }))
      .toBe("My Home Proxy");
  });
});

describe("deriveHealth", () => {
  it("maps testStatus to health buckets", () => {
    expect(deriveHealth({ testStatus: "active" })).toBe("healthy");
    expect(deriveHealth({ testStatus: "error" })).toBe("error");
    expect(deriveHealth({ testStatus: "unknown" })).toBe("unknown");
    expect(deriveHealth({})).toBe("unknown");
  });
});

describe("formatLatency", () => {
  it("formats sub-second as ms", () => {
    expect(formatLatency(312)).toBe("312ms");
  });
  it("formats >=1s as seconds", () => {
    expect(formatLatency(1450)).toBe("1.4s");
  });
  it("returns null for missing/invalid", () => {
    expect(formatLatency(null)).toBeNull();
    expect(formatLatency(undefined)).toBeNull();
    expect(formatLatency(-5)).toBeNull();
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-06-01T00:00:00.000Z").getTime();
  it("returns Never for empty", () => {
    expect(formatRelativeTime(null, now)).toBe("Never");
    expect(formatRelativeTime("not-a-date", now)).toBe("Never");
  });
  it("formats recent as just now", () => {
    expect(formatRelativeTime(new Date(now - 10_000).toISOString(), now)).toBe("just now");
  });
  it("formats minutes/hours/days", () => {
    expect(formatRelativeTime(new Date(now - 5 * 60_000).toISOString(), now)).toBe("5m ago");
    expect(formatRelativeTime(new Date(now - 3 * 3600_000).toISOString(), now)).toBe("3h ago");
    expect(formatRelativeTime(new Date(now - 2 * 86_400_000).toISOString(), now)).toBe("2d ago");
  });
});

describe("PROXY_KIND_ORDER", () => {
  it("lists socks5 and http before relays", () => {
    expect(PROXY_KIND_ORDER.slice(0, 2)).toEqual(["socks5", "http"]);
    expect(PROXY_KIND_ORDER).toContain("vercel");
    expect(PROXY_KIND_ORDER).toContain("deno");
  });
});
