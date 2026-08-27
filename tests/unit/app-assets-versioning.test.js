import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildAssetVersion, versionedAssetUrl } from "@/lib/appAssets";
import manifest from "@/app/manifest";
import nextConfig from "../../next.config.mjs";

function withEnv(value, fn) {
  const had = "NEXT_PUBLIC_BUILD_TIME" in process.env;
  const prev = process.env.NEXT_PUBLIC_BUILD_TIME;
  if (value === undefined) delete process.env.NEXT_PUBLIC_BUILD_TIME;
  else process.env.NEXT_PUBLIC_BUILD_TIME = value;
  try {
    return fn();
  } finally {
    if (had) process.env.NEXT_PUBLIC_BUILD_TIME = prev;
    else delete process.env.NEXT_PUBLIC_BUILD_TIME;
  }
}

describe("buildAssetVersion", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_BUILD_TIME = "2026-08-27T00:00:00.000Z";
  });
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_BUILD_TIME;
  });

  it("uses the stamped build time as the version", () => {
    expect(buildAssetVersion()).toBe("2026-08-27T00:00:00.000Z");
  });

  it("is stable across calls within one build", () => {
    expect(buildAssetVersion()).toBe(buildAssetVersion());
  });
});

describe("versionedAssetUrl", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_BUILD_TIME;
  });

  it("appends an encoded v query parameter", () => {
    withEnv("2026-01-01T10:20:30.000Z", () => {
      // ISO colons must be percent-encoded so the URL stays valid everywhere
      expect(versionedAssetUrl("/favicon.svg")).toBe(
        "/favicon.svg?v=2026-01-01T10%3A20%3A30.000Z"
      );
    });
  });

  it("falls back to a stable 'dev' version when the build stamp is missing", () => {
    withEnv(undefined, () => {
      expect(buildAssetVersion()).toBe("dev");
      expect(versionedAssetUrl("/icons/icon-512.svg")).toBe("/icons/icon-512.svg?v=dev");
    });
  });

  it("treats whitespace-only stamps like a missing stamp", () => {
    withEnv("   ", () => {
      expect(buildAssetVersion()).toBe("dev");
    });
  });
});

describe("manifest icon versioning", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_BUILD_TIME;
  });

  it("versions every icon URL with the same current build version", () => {
    withEnv("2026-02-03T04:05:06.000Z", () => {
      const m = manifest();
      const expected = new URLSearchParams({ v: buildAssetVersion() }).toString();
      expect(m.icons.length).toBeGreaterThan(0);
      for (const icon of m.icons) {
        const url = new URL(icon.src, "https://x.local");
        expect(url.pathname).toMatch(/^\/icons\/icon-(192|512)\.svg$/);
        expect(url.search).toBe(`?${expected}`);
      }
      const versions = new Set(m.icons.map((i) => new URL(i.src, "https://x.local").searchParams.get("v")));
      expect(versions.size).toBe(1);
    });
  });
});

describe("cache-control header rules", () => {
  const cacheHeaders = (rule) =>
    Object.fromEntries(rule.headers.map((h) => [h.key, h.value]));

  it("covers exactly the favicon, PWA icons, and manifest — nothing else", async () => {
    const rules = await nextConfig.headers();
    const sources = rules.map((r) => r.source);
    expect(sources.sort()).toEqual([
      "/favicon.svg",
      "/favicon.svg",
      "/icons/icon-192.svg",
      "/icons/icon-192.svg",
      "/icons/icon-512.svg",
      "/icons/icon-512.svg",
      "/manifest.webmanifest",
    ]);
    // No glob rules that could leak onto fingerprinted assets or other routes
    for (const s of sources) expect(s).not.toMatch(/[*:]/);
    for (const s of sources) expect(s.startsWith("/_next")).toBe(false);
  });

  it("bare paths revalidate while ?v= variants long-cache immutably", async () => {
    const rules = await nextConfig.headers();
    for (const rule of rules) {
      const hasQueryV = rule.has?.some((h) => h.type === "query" && h.key === "v");
      const cc = cacheHeaders(rule)["Cache-Control"];
      if (hasQueryV) expect(cc).toBe("public, max-age=31536000, immutable");
      else expect(cc).toBe("public, no-cache, must-revalidate");
    }
  });

  it("applies the no-store-family nowhere — /_next/static policy stays Next's own", async () => {
    const rules = await nextConfig.headers();
    const all = rules.flatMap((r) => Object.values(cacheHeaders(r)));
    for (const v of all) expect(v.includes("no-store")).toBe(false);
  });
});
