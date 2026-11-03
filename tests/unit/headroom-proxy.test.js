import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({ headroomUrl: "http://localhost:8787" })),
}));

vi.mock("@/lib/headroom/detect", () => ({
  DEFAULT_HEADROOM_URL: "http://localhost:8787",
}));

import { GET } from "../../src/app/api/headroom/proxy/[...path]/route.js";

describe("headroom dashboard proxy route", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rewrites dashboard html asset paths and fetch calls to use proxy prefix", async () => {
    const rawHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <script src="/dashboard/static/alpine.min.js"></script>
          <link rel="stylesheet" href='/dashboard/static/tailwind.min.css'>
        </head>
        <body>
          <script>
            this.fetchJson('/stats?cached=1');
            fetch('/stats-history?limit=50');
            fetch('/transformations/feed');
            fetch('/health');
          </script>
        </body>
      </html>
    `;

    global.fetch = vi.fn(async () => new Response(rawHtml, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }));

    const req = new Request("http://localhost:20128/api/headroom/proxy/dashboard");
    const res = await GET(req, { params: Promise.resolve({ path: ["dashboard"] }) });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('src="/api/headroom/proxy/dashboard/static/alpine.min.js"');
    expect(text).toContain("href='/api/headroom/proxy/dashboard/static/tailwind.min.css'");
    expect(text).toContain("this.fetchJson('/api/headroom/proxy/stats?cached=1')");
    expect(text).toContain("fetch('/api/headroom/proxy/stats-history?limit=50')");
    expect(text).toContain("fetch('/api/headroom/proxy/transformations/feed')");
    expect(text).toContain("fetch('/api/headroom/proxy/health')");
  });

  it("passes through non-html responses directly without body rewriting", async () => {
    const jsonBody = JSON.stringify({ ok: true });
    global.fetch = vi.fn(async () => new Response(jsonBody, {
      status: 200,
      headers: { "content-type": "application/json" },
    }));

    const req = new Request("http://localhost:20128/api/headroom/proxy/stats");
    const res = await GET(req, { params: Promise.resolve({ path: ["stats"] }) });

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(jsonBody);
  });
});
