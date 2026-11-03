import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(async () => ({ headroomUrl: "http://localhost:8787" })),
}));

vi.mock("@/lib/localDb.js", () => ({
  getSettings: mocks.getSettings,
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
}));

vi.mock("@/lib/headroom/detect.js", () => ({
  DEFAULT_HEADROOM_URL: "http://localhost:8787",
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

  it("rewrites settings page links and settings API fetch calls", async () => {
    const rawSettingsHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <script src="/dashboard/static/tailwind.min.js"></script>
        </head>
        <body>
          <a href="/dashboard" class="text-sm">&larr; Dashboard</a>
          <script>
            const s = await fetch('/settings/schema');
            const save = await fetch('/settings', { method: 'POST' });
            const apply = await fetch('/settings/apply', { method: 'POST' });
            const h = await fetch('/health');
          </script>
        </body>
      </html>
    `;

    global.fetch = vi.fn(async () => new Response(rawSettingsHtml, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }));

    const req = new Request("http://localhost:20128/api/headroom/proxy/dashboard/settings");
    const res = await GET(req, { params: Promise.resolve({ path: ["dashboard", "settings"] }) });

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('src="/api/headroom/proxy/dashboard/static/tailwind.min.js"');
    expect(text).toContain('href="/api/headroom/proxy/dashboard"');
    expect(text).toContain("fetch('/api/headroom/proxy/settings/schema')");
    expect(text).toContain("fetch('/api/headroom/proxy/settings',");
    expect(text).toContain("fetch('/api/headroom/proxy/settings/apply',");
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

  it("returns offline html page when proxy is unreachable and accept header includes text/html", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:8787");
    });

    const req = new Request("http://localhost:20128/api/headroom/proxy/dashboard", {
      headers: { accept: "text/html" },
    });
    const res = await GET(req, { params: Promise.resolve({ path: ["dashboard"] }) });

    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toContain("Headroom proxy is not running");
  });

  it("returns 502 json when proxy is unreachable for json request", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED 127.0.0.1:8787");
    });

    const req = new Request("http://localhost:20128/api/headroom/proxy/stats", {
      headers: { accept: "application/json" },
    });
    const res = await GET(req, { params: Promise.resolve({ path: ["stats"] }) });

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toContain("Headroom proxy is not running");
  });
});
