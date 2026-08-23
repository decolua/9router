import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getSettings: vi.fn(async () => ({ headroomUrl: "http://localhost:8787" })),
}));

const { DASHBOARD_PREFIX, rewriteHeadroomHtml, rewriteLocation, forwardedHeaders } =
  await import("../../src/app/api/headroom/proxy/[...path]/route.js");

const { getSettings } = await import("@/lib/localDb");

const ENV_KEYS = ["HEADROOM_API_KEY", "HEADROOM_PROXY_TOKEN"];

function saveEnv() {
  return ENV_KEYS.map((k) => [k, process.env[k]]);
}

function restoreEnv(saved) {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe("rewriteHeadroomHtml", () => {
  it("rewrites allow-listed src/href/action and fetch literals, preserving query/hash and quote type", () => {
    const html = [
      '<script src="/assets/app.js?v=2"></script>',
      '<link href="/_next/static/css/app.css#x">',
      '<a href="/dashboard/sub?page=1">dash</a>',
      "<form action=\"/metrics\"></form>",
      "<script>fetch('/stats')</script>",
      'fetch("/stats-history?from=1#top")',
      "fetch(`/health`)",
    ].join("");
    const out = rewriteHeadroomHtml(html, DASHBOARD_PREFIX);
    expect(out).toContain(`${DASHBOARD_PREFIX}/assets/app.js?v=2`);
    expect(out).toContain(`${DASHBOARD_PREFIX}/_next/static/css/app.css#x`);
    expect(out).toContain(`${DASHBOARD_PREFIX}/dashboard/sub?page=1`);
    expect(out).toContain(`${DASHBOARD_PREFIX}/metrics`);
    expect(out).toContain(`fetch('${DASHBOARD_PREFIX}/stats')`);
    expect(out).toContain(`fetch("${DASHBOARD_PREFIX}/stats-history?from=1#top")`);
    expect(out).toContain("fetch(`/api/headroom/proxy/health`)");
  });

  it("leaves absolute, protocol-relative, scheme URLs and unknown root paths untouched", () => {
    const html = [
      '<script src="https://cdn.example/x.js"></script>',
      '<script src="//cdn.example/y.js"></script>',
      '<img src="data:image/png;base64,AAA">',
      '<a href="javascript:void(0)">j</a>',
      '<a href="mailto:a@b.c">m</a>',
      '<a href="blob:https://x/y">b</a>',
      '<script src="/vendor/lib.js"></script>',
      "fetch('/unknown/path')",
      "fetch('https://ext.example/z')",
    ].join("");
    const out = rewriteHeadroomHtml(html, DASHBOARD_PREFIX);
    expect(out).toBe(html);
    expect(out).not.toContain(DASHBOARD_PREFIX);
  });

  it("does not rewrite escaped or dynamic template expressions", () => {
    const html = "fetch(`/stats/${page}`) fetch('/stats\\/x')";
    const out = rewriteHeadroomHtml(html, DASHBOARD_PREFIX);
    expect(out).toBe(html);
  });

  it("is idempotent - second pass changes nothing", () => {
    const html = '<script src="/assets/app.js"></script><a href="/dashboard">d</a>fetch(\'/stats\')';
    const once = rewriteHeadroomHtml(html, DASHBOARD_PREFIX);
    const twice = rewriteHeadroomHtml(once, DASHBOARD_PREFIX);
    expect(twice).toBe(once);
  });

  it("returns non-string input unchanged", () => {
    expect(rewriteHeadroomHtml(null)).toBeNull();
    expect(rewriteHeadroomHtml(undefined)).toBeUndefined();
    expect(rewriteHeadroomHtml("")).toBe("");
  });

  it("does not rewrite axios calls (no evidence Headroom uses it)", () => {
    const html = "axios('/stats')";
    expect(rewriteHeadroomHtml(html, DASHBOARD_PREFIX)).toBe(html);
  });
});

describe("rewriteLocation", () => {
  const target = new URL("http://localhost:8787");

  it("rewrites root-relative locations preserving query/hash", () => {
    expect(rewriteLocation("/dashboard/login", target)).toBe(
      `${DASHBOARD_PREFIX}/dashboard/login`
    );
    expect(rewriteLocation("/stats?a=1#h", target)).toBe(`${DASHBOARD_PREFIX}/stats?a=1#h`);
  });

  it("rewrites same-origin absolute locations through the proxy", () => {
    expect(rewriteLocation("http://localhost:8787/stats?x=1", target)).toBe(
      `${DASHBOARD_PREFIX}/stats?x=1`
    );
    expect(rewriteLocation("http://localhost:8787/dashboard/sub", target)).toBe(
      `${DASHBOARD_PREFIX}/dashboard/sub`
    );
  });

  it("maps same-origin redirects when the target has a base pathname", () => {
    const based = new URL("http://localhost:8787/sub");
    expect(rewriteLocation("http://localhost:8787/sub/stats", based)).toBe(
      `${DASHBOARD_PREFIX}/sub/stats`
    );
    expect(rewriteLocation("sub/stats", based)).toBe(`${DASHBOARD_PREFIX}/sub/stats`);
  });

  it("leaves external, protocol-relative, non-http and already-prefixed locations untouched", () => {
    expect(rewriteLocation("https://external.example/x", target)).toBe(
      "https://external.example/x"
    );
    expect(rewriteLocation("//evil.example/x", target)).toBe("//evil.example/x");
    expect(rewriteLocation("mailto:a@b.c", target)).toBe("mailto:a@b.c");
    expect(rewriteLocation("ftp://h/x", target)).toBe("ftp://h/x");
    expect(rewriteLocation(`${DASHBOARD_PREFIX}/stats`, target)).toBe(
      `${DASHBOARD_PREFIX}/stats`
    );
  });

  it("handles null/empty/malformed safely", () => {
    expect(rewriteLocation(null, target)).toBeNull();
    expect(rewriteLocation("", target)).toBe("");
    expect(rewriteLocation("http://[::bad", target)).toBe("http://[::bad");
  });
});

describe("forwardedHeaders", () => {
  beforeEach(() => {
    delete process.env.HEADROOM_API_KEY;
    delete process.env.HEADROOM_PROXY_TOKEN;
  });
  afterEach(() => restoreEnv(saveEnv()));

  const mkReq = (headers) => ({ headers: new Headers(headers) });

  it("always strips cookie/authorization/host and hop-by-hop headers for loopback targets", () => {
    const h = forwardedHeaders(
      mkReq({
        cookie: "auth_token=viewer-secret",
        authorization: "Bearer viewer-session",
        host: "localhost:20128",
        connection: "keep-alive",
        "transfer-encoding": "chunked",
        "x-custom": "keep",
      }),
      new URL("http://localhost:8787/dashboard")
    );
    expect(h.get("cookie")).toBeNull();
    expect(h.get("authorization")).toBeNull();
    expect(h.get("host")).toBeNull();
    expect(h.get("connection")).toBeNull();
    expect(h.get("transfer-encoding")).toBeNull();
    expect(h.get("x-custom")).toBe("keep");
  });

  it("strips viewer credentials for external targets too", () => {
    const h = forwardedHeaders(
      mkReq({ cookie: "auth_token=viewer-secret", authorization: "Bearer viewer-session" }),
      new URL("http://192.168.1.10:8787/dashboard")
    );
    expect(h.get("cookie")).toBeNull();
    expect(h.get("authorization")).toBeNull();
  });

  it("injects Bearer from trimmed HEADROOM_API_KEY only", () => {
    process.env.HEADROOM_API_KEY = "  sk-headroom-123  ";
    const h = forwardedHeaders(mkReq({}), new URL("http://localhost:8787/"));
    expect(h.get("authorization")).toBe("Bearer sk-headroom-123");
  });

  it("never forwards HEADROOM_PROXY_TOKEN as a credential", () => {
    process.env.HEADROOM_PROXY_TOKEN = "proxy-secret-token";
    const h = forwardedHeaders(
      mkReq({ authorization: "Bearer viewer-session" }),
      new URL("http://localhost:8787/")
    );
    expect(h.get("authorization")).toBeNull();
    const h2 = forwardedHeaders(mkReq({}), new URL("http://localhost:8787/"));
    expect(h2.get("authorization")).toBeNull();
  });

  it("prefers HEADROOM_API_KEY and ignores HEADROOM_PROXY_TOKEN fallback", () => {
    process.env.HEADROOM_API_KEY = "sk-real";
    process.env.HEADROOM_PROXY_TOKEN = "proxy-secret-token";
    const h = forwardedHeaders(mkReq({}), new URL("http://localhost:8787/"));
    expect(h.get("authorization")).toBe("Bearer sk-real");
  });
});

describe("proxy handler", () => {
  const route = () =>
    import("../../src/app/api/headroom/proxy/[...path]/route.js");

  beforeEach(() => {
    delete process.env.HEADROOM_API_KEY;
    delete process.env.HEADROOM_PROXY_TOKEN;
    getSettings.mockResolvedValue({ headroomUrl: "http://localhost:8787" });
  });
  afterEach(() => restoreEnv(saveEnv()));

  function makeRequest(url = "http://app.local/api/headroom/proxy/dashboard", headers = {}) {
    return new Request(url, { method: "GET", headers });
  }

  async function callGet(request, pathSegments) {
    const mod = await route();
    return mod.GET(request, { params: Promise.resolve({ path: pathSegments }) });
  }

  it("rewrites text/html bodies regardless of catch-all path and drops stale content-length", async () => {
    global.fetch = vi.fn(async () =>
      new Response('<a href="/dashboard">d</a><script>fetch(\'/stats\')</script>', {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8", "content-length": "9999" },
      })
    );
    const res = await callGet(makeRequest(), ["dashboard"]);
    const body = await res.text();
    expect(body).toContain(`${DASHBOARD_PREFIX}/dashboard`);
    expect(body).toContain(`fetch('${DASHBOARD_PREFIX}/stats')`);
    expect(res.headers.get("content-length")).toBeNull();
  });

  it("leaves non-HTML bodies (json/sse/binary) untouched", async () => {
    const payload = JSON.stringify({ fetch: "fetch('/stats')" });
    global.fetch = vi.fn(async () =>
      new Response(payload, {
        status: 200,
        headers: { "content-type": "application/json", "content-length": String(payload.length) },
      })
    );
    const res = await callGet(makeRequest(), ["stats"]);
    const body = await res.text();
    expect(body).toBe(payload);
    expect(res.headers.get("content-length")).toBe(String(payload.length));

    global.fetch = vi.fn(async () =>
      new Response("data: x\n\n", {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      })
    );
    const res2 = await callGet(makeRequest(), ["events"]);
    expect(await res2.text()).toBe("data: x\n\n");
  });

  it("rewrites 3xx Location headers without duplication", async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      global.fetch = vi.fn(async () =>
        new Response(null, { status, headers: { location: "/dashboard/login" } })
      );
      const res = await callGet(makeRequest(), ["old"]);
      expect(res.headers.get("location")).toBe(`${DASHBOARD_PREFIX}/dashboard/login`);

      global.fetch = vi.fn(async () =>
        new Response(null, { status, headers: { location: "https://external.example/x" } })
      );
      const res2 = await callGet(makeRequest(), ["old"]);
      expect(res2.headers.get("location")).toBe("https://external.example/x");
    }
  });

  it("strips viewer cookies/authorization upstream and injects HEADROOM_API_KEY Bearer", async () => {
    let seen;
    global.fetch = vi.fn(async (target, init) => {
      seen = { target: String(target), headers: init.headers };
      return new Response("<p>x</p>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    });
    process.env.HEADROOM_API_KEY = "sk-inject";
    const req = makeRequest("http://app.local/api/headroom/proxy/dashboard", {
      cookie: "auth_token=viewer-secret",
      authorization: "Bearer viewer-session",
      "x-custom": "keep",
    });
    const res = await callGet(req, ["dashboard"]);
    expect(res.status).toBe(200);
    expect(seen.target).toBe("http://localhost:8787/dashboard");
    expect(seen.headers.get("cookie")).toBeNull();
    expect(seen.headers.get("authorization")).toBe("Bearer sk-inject");
    expect(seen.headers.get("x-custom")).toBe("keep");
  });

  it("uses manual redirects upstream", async () => {
    let init;
    global.fetch = vi.fn(async (_t, i) => {
      init = i;
      return new Response("ok", { status: 200, headers: { "content-type": "text/plain" } });
    });
    await callGet(makeRequest(), ["health"]);
    expect(init.redirect).toBe("manual");
  });

  it("rejects non-http(s) configured targets with a bounded error", async () => {
    getSettings.mockResolvedValue({ headroomUrl: "file:///etc/passwd" });
    const res = await callGet(makeRequest(), ["dashboard"]);
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toBe("Headroom proxy request failed");
  });

  it("returns a generic bounded error when upstream fails - no secrets, no upstream body echo", async () => {
    global.fetch = vi.fn(async () => {
      throw new Error("fetch failed http://user:pass@10.0.0.9 HEADROOM_API_KEY=sk-x 401 unauthorized");
    });
    const res = await callGet(makeRequest(), ["dashboard"]);
    expect(res.status).toBe(502);
    const data = await res.json();
    expect(data.error).toBe("Headroom proxy request failed");
    expect(JSON.stringify(data)).not.toContain("sk-x");
    expect(JSON.stringify(data)).not.toContain("user:pass");
    expect(JSON.stringify(data)).not.toMatch(/401|unauthorized/i);
  });
});
