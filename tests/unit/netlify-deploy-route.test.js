import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: {
    json: vi.fn((body, init) => ({
      status: init?.status || 200,
      body,
      json: async () => body,
    })),
  },
}));

vi.mock("@/models", () => ({
  createProxyPool: vi.fn(async (input) => ({ id: "pool-1", ...input })),
}));

function request(body) {
  return { json: vi.fn(async () => body) };
}

describe("POST /api/proxy-pools/netlify-deploy", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns 400 when netlifyToken is missing", async () => {
    const { POST } = await import("../../src/app/api/proxy-pools/netlify-deploy/route.js");
    const res = await POST(request({ projectName: "netlify-relay" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toContain("Netlify API token is required");
  });

  it("creates a Netlify site, uploads relay files, polls deployment, and persists a proxy pool", async () => {
    global.fetch = vi.fn(async (url, options = {}) => {
      const urlString = String(url);
      if (urlString.endsWith("/sites") && options.method === "POST") {
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: "site-1", name: "relay", ssl_url: "https://relay.netlify.app" }),
        };
      }
      if (urlString.endsWith("/deploys") && options.method === "POST") {
        const files = JSON.parse(options.body).files;
        return {
          ok: true,
          status: 201,
          json: async () => ({
            id: "deploy-1",
            ssl_url: "https://relay.netlify.app",
            required: Object.values(files),
          }),
        };
      }
      if (urlString.includes("/deploys/deploy-1/files/")) {
        return { ok: true, status: 200, text: async () => "" };
      }
      if (urlString.endsWith("/deploys/deploy-1")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ state: "ready" }),
        };
      }
      if (urlString === "https://relay.netlify.app") {
        return {
          ok: false,
          status: 400,
          headers: { get: (name) => (name === "content-type" ? "application/json" : null) },
          json: async () => ({ error: "Missing x-relay-target header" }),
        };
      }
      throw new Error(`unexpected fetch: ${urlString}`);
    });

    const { createProxyPool } = await import("@/models");
    const { POST } = await import("../../src/app/api/proxy-pools/netlify-deploy/route.js");
    const res = await POST(request({ netlifyToken: "nfp_test", projectName: "relay" }));
    const body = await res.json();

    const initDeployCall = global.fetch.mock.calls.find(([url]) => String(url).endsWith("/sites/site-1/deploys"));
    expect(JSON.parse(initDeployCall[1].body).files).toEqual(expect.objectContaining({
      "index.html": expect.any(String),
      "netlify/edge-functions/relay.js": expect.any(String),
      "netlify.toml": expect.any(String),
    }));
    expect(global.fetch.mock.calls.some(([url]) => decodeURIComponent(String(url)).includes("/files/index.html"))).toBe(true);
    expect(global.fetch.mock.calls.some(([url]) => decodeURIComponent(String(url)).includes("/files/netlify/edge-functions/relay.js"))).toBe(true);
    expect(global.fetch.mock.calls.some(([url]) => decodeURIComponent(String(url)).includes("/files/netlify.toml"))).toBe(true);
    expect(res.status).toBe(201);
    expect(body.deployUrl).toBe("https://relay.netlify.app");
    expect(createProxyPool).toHaveBeenCalledWith(expect.objectContaining({
      name: "relay",
      proxyUrl: "https://relay.netlify.app",
      type: "netlify",
      isActive: true,
    }));
  });

  it("returns the upstream status when site creation fails (invalid token)", async () => {
    global.fetch = vi.fn(async (url, options = {}) => {
      if (String(url).endsWith("/sites") && options.method === "POST") {
        return {
          ok: false,
          status: 401,
          json: async () => ({ message: "Invalid token" }),
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { createProxyPool } = await import("@/models");
    const { POST } = await import("../../src/app/api/proxy-pools/netlify-deploy/route.js");
    const res = await POST(request({ netlifyToken: "nfp_bad", projectName: "relay" }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("Invalid token");
    expect(createProxyPool).not.toHaveBeenCalled();
  });

  it("cleans up the created site when deploy initiation fails", async () => {
    const calls = [];
    global.fetch = vi.fn(async (url, options = {}) => {
      const u = String(url);
      calls.push({ url: u, method: options.method || "GET" });
      if (u.endsWith("/sites") && options.method === "POST") {
        return { ok: true, status: 201, json: async () => ({ id: "site-1", name: "relay", ssl_url: "https://relay.netlify.app" }) };
      }
      if (u.endsWith("/sites/site-1/deploys") && options.method === "POST") {
        return { ok: false, status: 422, json: async () => ({ message: "Deploy init failed" }) };
      }
      if (u.endsWith("/sites/site-1") && options.method === "DELETE") {
        return { ok: true, status: 204, json: async () => ({}) };
      }
      throw new Error(`unexpected fetch: ${u}`);
    });

    const { createProxyPool } = await import("@/models");
    const { POST } = await import("../../src/app/api/proxy-pools/netlify-deploy/route.js");
    const res = await POST(request({ netlifyToken: "nfp_test", projectName: "relay" }));
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error).toContain("Deploy init failed");
    expect(createProxyPool).not.toHaveBeenCalled();
    expect(calls.some((c) => c.url.endsWith("/sites/site-1") && c.method === "DELETE")).toBe(true);
  });

  it("surfaces deployment errors when Netlify reports state=error during polling", async () => {
    global.fetch = vi.fn(async (url, options = {}) => {
      const u = String(url);
      if (u.endsWith("/sites") && options.method === "POST") {
        return { ok: true, status: 201, json: async () => ({ id: "site-1", name: "relay", ssl_url: "https://relay.netlify.app" }) };
      }
      if (u.endsWith("/deploys") && options.method === "POST") {
        return { ok: true, status: 201, json: async () => ({ id: "deploy-1", required: [] }) };
      }
      if (u.endsWith("/deploys/deploy-1")) {
        return { ok: true, status: 200, json: async () => ({ state: "error", error_message: "build crashed" }) };
      }
      throw new Error(`unexpected fetch: ${u}`);
    });

    const { POST } = await import("../../src/app/api/proxy-pools/netlify-deploy/route.js");
    const res = await POST(request({ netlifyToken: "nfp_test", projectName: "relay" }));
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("build crashed");
  });

  it("deletes the created site and returns 502 when relay verification fails (inactive edge function)", async () => {
    const calls = [];
    global.fetch = vi.fn(async (url, options = {}) => {
      const u = String(url);
      calls.push({ url: u, method: options.method || "GET" });
      if (u.endsWith("/sites") && options.method === "POST") {
        return { ok: true, status: 201, json: async () => ({ id: "site-1", name: "relay", ssl_url: "https://relay.netlify.app" }) };
      }
      if (u.endsWith("/sites/site-1/deploys") && options.method === "POST") {
        return { ok: true, status: 201, json: async () => ({ id: "deploy-1", required: [] }) };
      }
      if (u.endsWith("/deploys/deploy-1")) {
        return { ok: true, status: 200, json: async () => ({ state: "ready" }) };
      }
      if (u === "https://relay.netlify.app") {
        return { ok: true, status: 200, headers: { get: () => "text/html" }, json: async () => ({}) };
      }
      if (u.endsWith("/sites/site-1") && options.method === "DELETE") {
        return { ok: true, status: 204, json: async () => ({}) };
      }
      throw new Error(`unexpected fetch: ${u}`);
    });

    const { createProxyPool } = await import("@/models");
    const { POST } = await import("../../src/app/api/proxy-pools/netlify-deploy/route.js");
    const res = await POST(request({ netlifyToken: "nfp_test", projectName: "relay" }));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toContain("Netlify relay verification failed");
    expect(createProxyPool).not.toHaveBeenCalled();
    expect(calls.some((c) => c.url.endsWith("/sites/site-1") && c.method === "DELETE")).toBe(true);
  });
});
