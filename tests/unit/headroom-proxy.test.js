import { describe, it, expect } from "vitest";
import { rewriteDashboardHtml } from "../../src/app/api/headroom/proxy/[...path]/route.js";

describe("headroom dashboard html rewrite", () => {
  it("rewrites static asset paths to use the proxy prefix", () => {
    const input = `
      <script src="/dashboard/static/tailwind.min.js"></script>
      <script src="/dashboard/static/htmx.min.js"></script>
      <script src="/dashboard/static/alpine.min.js" defer></script>
    `;
    const output = rewriteDashboardHtml(input);

    expect(output).toContain('src="/api/headroom/proxy/dashboard/static/tailwind.min.js"');
    expect(output).toContain('src="/api/headroom/proxy/dashboard/static/htmx.min.js"');
    expect(output).toContain('src="/api/headroom/proxy/dashboard/static/alpine.min.js"');
  });

  it("rewrites dashboard settings link", () => {
    const input = '<a href="/dashboard/settings" id="settings-link">Settings</a>';
    const output = rewriteDashboardHtml(input);

    expect(output).toContain('href="/api/headroom/proxy/dashboard/settings"');
  });

  it("rewrites api fetch paths to use the proxy prefix", () => {
    const input = "fetch('/stats?cached=1'); fetch('/health'); fetch('/stats-history'); fetch('/transformations/feed?limit=50');";
    const output = rewriteDashboardHtml(input);

    expect(output).toContain("fetch('/api/headroom/proxy/stats?cached=1')");
    expect(output).toContain("fetch('/api/headroom/proxy/health')");
    expect(output).toContain("fetch('/api/headroom/proxy/stats-history')");
    expect(output).toContain("fetch('/api/headroom/proxy/transformations/feed?limit=50')");
  });

  it("leaves external URLs untouched", () => {
    const input = '<a href="https://headroom-docs.vercel.app/docs">Docs</a>';
    const output = rewriteDashboardHtml(input);

    expect(output).toBe(input);
  });
});
