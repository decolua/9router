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
        return {
          ok: true,
          status: 201,
          json: async () => ({ id: "deploy-1", ssl_url: "https://relay.netlify.app" }),
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
      throw new Error(`unexpected fetch: ${urlString}`);
    });

    const { createProxyPool } = await import("@/models");
    const { POST } = await import("../../src/app/api/proxy-pools/netlify-deploy/route.js");
    const res = await POST(request({ netlifyToken: "nfp_test", projectName: "relay" }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.deployUrl).toBe("https://relay.netlify.app");
    expect(createProxyPool).toHaveBeenCalledWith(expect.objectContaining({
      name: "relay",
      proxyUrl: "https://relay.netlify.app",
      type: "netlify",
      isActive: true,
    }));
  });
});
