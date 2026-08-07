// FED-003 — edge proxy tests (spec §3.2).
//
// Covers:
//  - forward-set matching: /v1/* any method; mutating dashboard API
//    (POST/PUT/PATCH/DELETE on /api/settings, /api/providers*, /api/keys*,
//    /api/models/alias, /api/combos*, /api/pricing, /api/usage*); dashboard
//    GET reads fall through
//  - SSE passthrough: real local central server emitting chunked SSE →
//    status/headers/chunks preserved in order, Authorization: Bearer
//    <token> present, x-9r-real-ip forwarded
//  - body forwarding: POST JSON body/method/path identical upstream
//  - abort propagation: client aborts mid-stream → upstream request aborted
//  - DEGRADED fall-through: last_state='degraded' → no forward, local
//    handler receives the request
//  - standalone no-op: FEDERATION_MODE unset → no forwarding
//  - missing config (no central URL / no token) → falls through, no crash
import http from "node:http";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const FED_ENV_KEYS = [
  "FEDERATION_MODE",
  "FEDERATION_CENTRAL_URL",
  "FEDERATION_EDGE_ID",
  "FEDERATION_SYNC_INTERVAL_MS",
  "FEDERATION_TOKEN",
];

const savedEnv = {};

beforeEach(() => {
  for (const k of FED_ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const k of FED_ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

async function loadProxy() {
  return import("@/lib/federation/proxy.js");
}

// ─── Forward-set matching ────────────────────────────────────────────────

describe("shouldForward (forward set, spec §3.2)", () => {
  it("forwards every /v1/* path regardless of method", async () => {
    const { shouldForward } = await loadProxy();
    for (const p of [
      "/v1/chat/completions",
      "/v1/messages",
      "/v1/responses",
      "/v1/models",
      "/v1/count_tokens",
      "/v1/embeddings",
      "/v1/chat/completions?stream=true",
    ]) {
      expect(shouldForward("POST", p)).toBe(true);
      expect(shouldForward("GET", p)).toBe(true);
    }
  });

  it("forwards mutating dashboard API calls", async () => {
    const { shouldForward } = await loadProxy();
    const cases = [
      ["PATCH", "/api/settings"],
      ["POST", "/api/settings/database"],
      ["POST", "/api/providers"],
      ["DELETE", "/api/providers/abc"],
      ["POST", "/api/keys"],
      ["DELETE", "/api/keys/k1"],
      ["PUT", "/api/models/alias"],
      ["DELETE", "/api/models/alias"],
      ["POST", "/api/combos"],
      ["DELETE", "/api/combos/c1"],
      ["PATCH", "/api/pricing"],
      ["DELETE", "/api/pricing"],
      ["POST", "/api/usage/whatever"],
    ];
    for (const [m, p] of cases) {
      expect(shouldForward(m, p)).toBe(true);
    }
  });

  it("does NOT forward dashboard GET reads (local replica serves them)", async () => {
    const { shouldForward } = await loadProxy();
    for (const p of [
      "/api/settings",
      "/api/providers",
      "/api/keys",
      "/api/models",
      "/api/models/alias",
      "/api/combos",
      "/api/pricing",
      "/api/usage/history",
      "/api/usage/stats",
      "/api/federation/status",
      "/dashboard",
      "/_next/static/chunk.js",
    ]) {
      expect(shouldForward("GET", p)).toBe(false);
    }
  });

  it("does NOT forward non-mutating methods on dashboard API paths", async () => {
    const { shouldForward } = await loadProxy();
    expect(shouldForward("GET", "/api/settings")).toBe(false);
    expect(shouldForward("OPTIONS", "/api/settings")).toBe(false);
  });
});

// ─── Header plumbing ─────────────────────────────────────────────────────

describe("buildUpstreamHeaders", () => {
  it("injects Authorization: Bearer <token> and forwards derived x-9r-real-ip", async () => {
    const { buildUpstreamHeaders } = await loadProxy();
    const out = buildUpstreamHeaders(
      {
        "x-9r-real-ip": "203.0.113.7",
        "x-9r-via-proxy": "1",
        "content-type": "application/json",
        accept: "text/event-stream",
        "x-forwarded-for": "1.2.3.4", // client-supplied — must stay stripped
        "x-real-ip": "5.6.7.8", // client-supplied — must stay stripped
        host: "edge.local",
        connection: "keep-alive",
        "content-length": "42",
      },
      "fed-token-123"
    );
    expect(out.Authorization).toBe("Bearer fed-token-123");
    expect(out["x-9r-real-ip"]).toBe("203.0.113.7");
    expect(out["content-type"]).toBe("application/json");
    expect(out.accept).toBe("text/event-stream");
    // Hop-by-hop + client-supplied forwarding headers never replayed
    expect(out["x-forwarded-for"]).toBeUndefined();
    expect(out["x-real-ip"]).toBeUndefined();
    expect(out["x-9r-via-proxy"]).toBeUndefined();
    expect(out.host).toBeUndefined();
    expect(out.connection).toBeUndefined();
    expect(out["content-length"]).toBeUndefined();
  });

  it("preserves the client's own Authorization as X-9r-Client-Authorization", async () => {
    const { buildUpstreamHeaders } = await loadProxy();
    const out = buildUpstreamHeaders({ authorization: "Bearer sk-client-key" }, "fed-token");
    expect(out.Authorization).toBe("Bearer fed-token");
    expect(out["X-9r-Client-Authorization"]).toBe("Bearer sk-client-key");
  });
});

// ─── Integration: real edge server pair + real central server ────────────

// Boot a real node:http "edge" server whose handler runs proxyRequest and
// falls through to a local handler when it returns false. Returns
// { server, port, close }.
function startEdgeServer({ getState, centralUrl, token, localHandler }) {
  const server = http.createServer(async (req, res) => {
    const { proxyRequest } = await import("@/lib/federation/proxy.js");
    const handled = await proxyRequest(req, res, { getState, centralUrl, token });
    if (!handled) localHandler(req, res);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function startCentralServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

function httpGet(port, path, { method = "GET", headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, path, method, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") })
        );
      }
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

describe("proxyRequest — SSE passthrough (acceptance 1)", () => {
  it("proxies /v1/chat/completions to central with Bearer token, chunks in order", async () => {
    process.env.FEDERATION_MODE = "edge";
    vi.resetModules();

    const seen = [];
    const central = await startCentralServer((req, res) => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, realIp: req.headers["x-9r-real-ip"] });
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      res.write("data: {\"a\":1}\n\n");
      setTimeout(() => res.write("data: {\"b\":2}\n\n"), 20);
      setTimeout(() => res.end("data: [DONE]\n\n"), 40);
    });

    const edge = await startEdgeServer({
      getState: () => "linked",
      centralUrl: `http://127.0.0.1:${central.port}`,
      token: "fed-token-abc",
      localHandler: (req, res) => res.end("LOCAL"),
    });

    try {
      const resp = await httpGet(edge.port, "/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-9r-real-ip": "203.0.113.9" },
        body: '{"model":"m","stream":true}',
      });
      expect(resp.status).toBe(200);
      expect(resp.headers["content-type"]).toContain("text/event-stream");
      // Chunks preserved in order
      expect(resp.body).toBe('data: {"a":1}\n\ndata: {"b":2}\n\ndata: [DONE]\n\n');
      // Central saw the federation token + derived real IP + original path
      expect(seen).toHaveLength(1);
      expect(seen[0].method).toBe("POST");
      expect(seen[0].url).toBe("/v1/chat/completions");
      expect(seen[0].auth).toBe("Bearer fed-token-abc");
      expect(seen[0].realIp).toBe("203.0.113.9");
    } finally {
      await edge.close();
      await central.close();
    }
  });

  it("forwards POST body/method/path identically (acceptance 2)", async () => {
    process.env.FEDERATION_MODE = "edge";
    vi.resetModules();

    let captured = null;
    const central = await startCentralServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        captured = { method: req.method, url: req.url, body: Buffer.concat(chunks).toString("utf8"), auth: req.headers.authorization };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end('{"ok":true}');
      });
    });

    const edge = await startEdgeServer({
      getState: () => "linked",
      centralUrl: `http://127.0.0.1:${central.port}`,
      token: "fed-token-xyz",
      localHandler: (req, res) => res.end("LOCAL"),
    });

    try {
      const body = JSON.stringify({ name: "p1", proxyUrl: "http://proxy:8080", type: "http" });
      const resp = await httpGet(edge.port, "/api/providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      expect(resp.status).toBe(200);
      expect(JSON.parse(resp.body)).toEqual({ ok: true });
      expect(captured.method).toBe("POST");
      expect(captured.url).toBe("/api/providers");
      expect(captured.body).toBe(body);
      expect(captured.auth).toBe("Bearer fed-token-xyz");
    } finally {
      await edge.close();
      await central.close();
    }
  });

  it("propagates client abort to the upstream request (acceptance 1)", async () => {
    process.env.FEDERATION_MODE = "edge";
    vi.resetModules();

    let upstreamAborted = false;
    let upstreamAbortResolve;
    const upstreamAbortPromise = new Promise((r) => (upstreamAbortResolve = r));

    const central = await startCentralServer((req, res) => {
      req.on("aborted", () => {
        upstreamAborted = true;
        upstreamAbortResolve();
      });
      req.on("close", () => {
        if (!upstreamAborted) upstreamAbortResolve();
      });
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write("data: first\n\n");
      // Never end — the client aborts mid-stream.
    });

    const edge = await startEdgeServer({
      getState: () => "linked",
      centralUrl: `http://127.0.0.1:${central.port}`,
      token: "fed-token-abc",
      localHandler: (req, res) => res.end("LOCAL"),
    });

    try {
      await new Promise((resolve, reject) => {
        const req = http.request(
          { host: "127.0.0.1", port: edge.port, path: "/v1/chat/completions", method: "POST" },
          (res) => {
            res.once("data", () => {
              // Client aborts mid-stream.
              req.destroy();
              resolve();
            });
          }
        );
        req.on("error", () => {}); // expected after destroy
        req.end('{"stream":true}');
        setTimeout(() => reject(new Error("no first chunk")), 3000);
      });
      await Promise.race([upstreamAbortPromise, new Promise((_, rej) => setTimeout(() => rej(new Error("upstream abort not observed")), 3000))]);
      expect(upstreamAborted).toBe(true);
    } finally {
      await edge.close();
      await central.close();
    }
  });
});

describe("proxyRequest — fall-through (acceptance 2/5)", () => {
  it("DEGRADED state → no forward; local handler receives the request", async () => {
    process.env.FEDERATION_MODE = "edge";
    vi.resetModules();

    let centralHit = false;
    const central = await startCentralServer((req, res) => {
      centralHit = true;
      res.end("CENTRAL");
    });

    let localServed = null;
    const edge = await startEdgeServer({
      getState: () => "degraded",
      centralUrl: `http://127.0.0.1:${central.port}`,
      token: "fed-token-abc",
      localHandler: (req, res) => {
        localServed = { method: req.method, url: req.url };
        res.end("LOCAL");
      },
    });

    try {
      const resp = await httpGet(edge.port, "/v1/chat/completions", { method: "POST", body: "{}" });
      expect(resp.body).toBe("LOCAL");
      expect(localServed).toEqual({ method: "POST", url: "/v1/chat/completions" });
      expect(centralHit).toBe(false);
    } finally {
      await edge.close();
      await central.close();
    }
  });

  it("standalone (FEDERATION_MODE unset) → no forwarding, local handler serves", async () => {
    vi.resetModules(); // FEDERATION_MODE already deleted in beforeEach

    let centralHit = false;
    const central = await startCentralServer((req, res) => {
      centralHit = true;
      res.end("CENTRAL");
    });

    let localServed = false;
    const edge = await startEdgeServer({
      getState: () => "linked",
      centralUrl: `http://127.0.0.1:${central.port}`,
      token: "fed-token-abc",
      localHandler: (req, res) => {
        localServed = true;
        res.end("LOCAL");
      },
    });

    try {
      const resp = await httpGet(edge.port, "/v1/chat/completions", { method: "POST", body: "{}" });
      expect(resp.body).toBe("LOCAL");
      expect(localServed).toBe(true);
      expect(centralHit).toBe(false);
    } finally {
      await edge.close();
      await central.close();
    }
  });

  it("dashboard GET reads fall through to local handler (not forwarded)", async () => {
    process.env.FEDERATION_MODE = "edge";
    vi.resetModules();

    let centralHit = false;
    const central = await startCentralServer((req, res) => {
      centralHit = true;
      res.end("CENTRAL");
    });

    let localServed = false;
    const edge = await startEdgeServer({
      getState: () => "linked",
      centralUrl: `http://127.0.0.1:${central.port}`,
      token: "fed-token-abc",
      localHandler: (req, res) => {
        localServed = true;
        res.end("LOCAL");
      },
    });

    try {
      const resp = await httpGet(edge.port, "/api/settings");
      expect(resp.body).toBe("LOCAL");
      expect(localServed).toBe(true);
      expect(centralHit).toBe(false);
    } finally {
      await edge.close();
      await central.close();
    }
  });

  it("missing FEDERATION_CENTRAL_URL → falls through locally, no crash", async () => {
    process.env.FEDERATION_MODE = "edge";
    vi.resetModules();

    let localServed = false;
    const edge = await startEdgeServer({
      getState: () => "linked",
      centralUrl: null, // missing
      token: "fed-token-abc",
      localHandler: (req, res) => {
        localServed = true;
        res.end("LOCAL");
      },
    });

    try {
      const resp = await httpGet(edge.port, "/v1/chat/completions", { method: "POST", body: "{}" });
      expect(resp.body).toBe("LOCAL");
      expect(localServed).toBe(true);
    } finally {
      await edge.close();
    }
  });

  it("missing FEDERATION_TOKEN → falls through locally, no crash", async () => {
    process.env.FEDERATION_MODE = "edge";
    vi.resetModules();

    let localServed = false;
    const edge = await startEdgeServer({
      getState: () => "linked",
      centralUrl: "http://127.0.0.1:1", // would fail if used
      token: null, // missing
      localHandler: (req, res) => {
        localServed = true;
        res.end("LOCAL");
      },
    });

    try {
      const resp = await httpGet(edge.port, "/v1/chat/completions", { method: "POST", body: "{}" });
      expect(resp.body).toBe("LOCAL");
      expect(localServed).toBe(true);
    } finally {
      await edge.close();
    }
  });

  it("upstream connection failure → 502 JSON, request handled (no local fall-through)", async () => {
    process.env.FEDERATION_MODE = "edge";
    vi.resetModules();

    // Port 1 on loopback: connection refused.
    const edge = await startEdgeServer({
      getState: () => "linked",
      centralUrl: "http://127.0.0.1:1",
      token: "fed-token-abc",
      localHandler: (req, res) => res.end("LOCAL"),
    });

    try {
      const resp = await httpGet(edge.port, "/v1/chat/completions", { method: "POST", body: "{}" });
      expect(resp.status).toBe(502);
      expect(JSON.parse(resp.body).error.code).toBe("FED_UPSTREAM_ERROR");
    } finally {
      await edge.close();
    }
  });
});
