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

const execFileMock = vi.fn();
vi.mock("child_process", () => ({
  execFile: (cmd, args, options, cb) => execFileMock(cmd, args, options, cb),
}));

function request(body) {
  return { json: vi.fn(async () => body) };
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function relayProbeResponse({ status = 400, contentType = "application/json", body = { error: "Missing x-relay-target header" } } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name === "content-type" ? contentType : null) },
    json: async () => body,
  };
}

function mockCliSuccess({ deployUrl = "https://relay.netlify.app", deployId = "deploy-1" } = {}) {
  execFileMock.mockImplementationOnce((cmd, args, options, cb) => {
    cb(null, {
      stdout: JSON.stringify({ deploy_url: deployUrl, deploy_id: deployId }) + "\n",
      stderr: "",
    });
  });
}

function mockCliFailure(message = "JSONHTTPError: Forbidden") {
  execFileMock.mockImplementationOnce((cmd, args, options, cb) => {
    const err = new Error(message);
    err.stderr = message;
    cb(err);
  });
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

  it("creates a Netlify site, deploys via CLI, verifies relay, and persists a proxy pool", async () => {
    mockCliSuccess();
    global.fetch = vi.fn(async (url, options = {}) => {
      const u = String(url);
      if (u.endsWith("/sites") && options.method === "POST") {
        return jsonResponse({ id: "site-1", name: "relay", ssl_url: "https://relay.netlify.app" }, 201);
      }
      if (u === "https://relay.netlify.app") return relayProbeResponse();
      throw new Error(`unexpected fetch: ${u}`);
    });

    const { createProxyPool } = await import("@/models");
    const { POST } = await import("../../src/app/api/proxy-pools/netlify-deploy/route.js");
    const res = await POST(request({ netlifyToken: "nfp_test", projectName: "relay" }));
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.deployUrl).toBe("https://relay.netlify.app");
    expect(execFileMock).toHaveBeenCalledWith(
      "npx",
      expect.arrayContaining(["netlify-cli@17", "deploy", "--prod", "--site", "site-1", "--json"]),
      expect.objectContaining({ env: expect.objectContaining({ NETLIFY_AUTH_TOKEN: "nfp_test" }) }),
      expect.any(Function)
    );
    expect(createProxyPool).toHaveBeenCalledWith(expect.objectContaining({
      name: "relay",
      proxyUrl: "https://relay.netlify.app",
      type: "netlify",
      isActive: true,
    }));
  });

  it("returns the upstream status when site creation fails", async () => {
    global.fetch = vi.fn(async (url, options = {}) => {
      if (String(url).endsWith("/sites") && options.method === "POST") {
        return jsonResponse({ message: "Invalid token" }, 401);
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const { createProxyPool } = await import("@/models");
    const { POST } = await import("../../src/app/api/proxy-pools/netlify-deploy/route.js");
    const res = await POST(request({ netlifyToken: "nfp_bad", projectName: "relay" }));
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toContain("Invalid token");
    expect(execFileMock).not.toHaveBeenCalled();
    expect(createProxyPool).not.toHaveBeenCalled();
  });

  it("deletes the created site and returns 502 when CLI deploy fails", async () => {
    const calls = [];
    mockCliFailure("JSONHTTPError: Forbidden");
    global.fetch = vi.fn(async (url, options = {}) => {
      const u = String(url);
      calls.push({ url: u, method: options.method || "GET" });
      if (u.endsWith("/sites") && options.method === "POST") return jsonResponse({ id: "site-1", name: "relay", ssl_url: "https://relay.netlify.app" }, 201);
      if (u.endsWith("/sites/site-1") && options.method === "DELETE") return jsonResponse({}, 204);
      throw new Error(`unexpected fetch: ${u}`);
    });

    const { createProxyPool } = await import("@/models");
    const { POST } = await import("../../src/app/api/proxy-pools/netlify-deploy/route.js");
    const res = await POST(request({ netlifyToken: "nfp_test", projectName: "relay" }));
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toContain("Forbidden");
    expect(createProxyPool).not.toHaveBeenCalled();
    expect(calls.some((c) => c.url.endsWith("/sites/site-1") && c.method === "DELETE")).toBe(true);
  });

  it("deletes the created site and returns 502 when relay verification fails", async () => {
    const calls = [];
    mockCliSuccess();
    global.fetch = vi.fn(async (url, options = {}) => {
      const u = String(url);
      calls.push({ url: u, method: options.method || "GET" });
      if (u.endsWith("/sites") && options.method === "POST") return jsonResponse({ id: "site-1", name: "relay", ssl_url: "https://relay.netlify.app" }, 201);
      if (u === "https://relay.netlify.app") return relayProbeResponse({ status: 404, contentType: "text/plain", body: {} });
      if (u.endsWith("/sites/site-1") && options.method === "DELETE") return jsonResponse({}, 204);
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
