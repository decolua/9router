import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({ headroomUrl: "http://127.0.0.1:8787" })),
}));

import { GET } from "../../src/app/api/headroom/proxy/[...path]/route.js";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe("Headroom dashboard proxy", () => {
  it("rewrites nested dashboard assets, links, and settings requests", async () => {
    const html = [
      '<script src="/dashboard/static/htmx.min.js"></script>',
      '<a href="/dashboard/settings">Settings</a>',
      "<script>fetch('/settings');fetch('/settings/schema');fetch('/settings/apply')</script>",
    ].join("");
    global.fetch = vi.fn(async () => new Response(html, {
      headers: { "content-type": "text/html; charset=utf-8" },
    }));

    const response = await GET(
      new Request("http://localhost/api/headroom/proxy/dashboard/settings?tab=general"),
      { params: Promise.resolve({ path: ["dashboard", "settings"] }) },
    );
    const rewritten = await response.text();

    expect(global.fetch).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:8787/dashboard/settings?tab=general"),
      expect.objectContaining({ method: "GET" }),
    );
    expect(rewritten).toContain('src="/api/headroom/proxy/dashboard/static/htmx.min.js"');
    expect(rewritten).toContain('href="/api/headroom/proxy/dashboard/settings"');
    expect(rewritten).toContain("fetch('/api/headroom/proxy/settings')");
    expect(rewritten).toContain("fetch('/api/headroom/proxy/settings/schema')");
    expect(rewritten).toContain("fetch('/api/headroom/proxy/settings/apply')");
  });
});
