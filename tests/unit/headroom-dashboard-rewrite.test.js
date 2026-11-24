import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The dashboard HTML is rewritten in-flight by
// src/app/api/headroom/proxy/[...path]/route.js. Importing that route pulls in
// Next.js and the local DB, so exercise the same regex through a local copy.
// Keep REWRITE_PATTERN byte-identical to the one in route.js.
const PREFIX = "/api/headroom/proxy";
const REWRITE_PATTERN =
  /(fetch\('|src="|href=")(?=\/(?:stats|health|stats-history|stats-lifetime|transformations\/feed|dashboard))/g;

function rewrite(html) {
  return html.replace(REWRITE_PATTERN, `$1${PREFIX}`);
}

const routeSource = readFileSync(
  fileURLToPath(new URL("../../src/app/api/headroom/proxy/[...path]/route.js", import.meta.url)),
  "utf8",
);

describe("headroom dashboard html rewrite", () => {
  it("keeps the test pattern in sync with route.js", () => {
    expect(routeSource).toContain(REWRITE_PATTERN.source);
  });

  it("prefixes stats-lifetime (Headroom >= 0.41)", () => {
    const out = rewrite("<script>fetch('/stats-lifetime')</script>");
    expect(out).toContain(`fetch('${PREFIX}/stats-lifetime`);
  });

  it("prefixes the previously covered stats endpoints", () => {
    const html = ["/stats", "/health", "/stats-history", "/transformations/feed"]
      .map((p) => `fetch('${p}')`)
      .join("");
    const out = rewrite(html);
    for (const p of ["/stats", "/health", "/stats-history", "/transformations/feed"]) {
      expect(out).toContain(`fetch('${PREFIX}${p}')`);
    }
  });

  it("prefixes absolute dashboard assets so the dashboard keeps its CSS/JS", () => {
    const html =
      '<script src="/dashboard/static/alpine.min.js"></script>' +
      '<script src="/dashboard/static/tailwind.min.js"></script>' +
      '<a href="/dashboard/settings">Settings</a>';
    const out = rewrite(html);
    expect(out).toContain(`src="${PREFIX}/dashboard/static/alpine.min.js"`);
    expect(out).toContain(`src="${PREFIX}/dashboard/static/tailwind.min.js"`);
    expect(out).toContain(`href="${PREFIX}/dashboard/settings"`);
  });

  it("does not touch external or unrelated URLs", () => {
    const html =
      '<a href="https://docs.headroomlabs.ai/docs">docs</a>' +
      '<a href="/login">login</a>' +
      "fetch('/v1/messages')";
    expect(rewrite(html)).toBe(html);
  });
});
