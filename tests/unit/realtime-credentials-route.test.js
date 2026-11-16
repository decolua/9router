import http from "node:http";
import { createRequire } from "node:module";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/lib/db/repos/apiKeysRepo.js", () => ({
  getApiKeyByKey: vi.fn(async (key) => key === "client-key" ? {
    id: "key-id",
    name: "test key",
    isActive: true,
    access: { restricted: false, allow: [] },
  } : null),
}));

vi.mock("../../src/sse/services/keyAccess.js", () => ({
  enforceKeyAccessResolved: vi.fn(async () => null),
}));

vi.mock("../../src/lib/localDb.js", () => ({
  getProviderConnections: vi.fn(async () => [{
    id: "connection-id",
    apiKey: "provider-secret",
    isActive: true,
    priority: 1,
    provider: "openai",
    providerSpecificData: {},
  }]),
  getSettings: vi.fn(async () => ({})),
  getProxyPools: vi.fn(async () => []),
  updateProviderConnection: vi.fn(),
}));

vi.mock("../../src/lib/network/connectionProxy.js", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
  pickProxyPoolId: vi.fn(),
}));

vi.mock("../../open-sse/services/pollinationsModels.js", () => ({
  resolvePollinationsModels: vi.fn(async () => ({ models: [{ id: "openai/gpt-realtime-2.1", kind: "realtime" }] })),
}));
const { POST } = await import("../../src/app/api/internal/realtime-credentials/route.js");
const { resolveConnectionProxyConfig } = await import("../../src/lib/network/connectionProxy.js");
const { getProviderConnections, updateProviderConnection } = await import("../../src/lib/localDb.js");
const { proxy: dashboardProxy } = await import("../../src/dashboardGuard.js");
const require = createRequire(import.meta.url);
const { WebSocket } = require("ws");
const upgrade = require("../../realtime/openai-realtime-websocket.js");

function request(headers = {}, body = { model: "gpt-realtime" }) {
  return new Request("http://127.0.0.1/api/internal/realtime-credentials", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("internal realtime credential route", () => {
  it("revokes sessions when the pinned account, credential, or proxy policy changes", async () => {
    globalThis[Symbol.for("9router.realtime.internal-secret")] = "process-secret";
    const headers = { "x-9r-realtime-secret": "process-secret", "x-9r-real-ip": "127.0.0.1", authorization: "Bearer client-key" };
    const body = { model: "gpt-realtime", validateOnly: true, connectionId: "connection-id", apiKey: "provider-secret" };
    expect((await POST(request(headers, body))).status).toBe(204);
    expect((await POST(request(headers, { ...body, apiKey: "old-secret" }))).status).toBe(403);
    vi.mocked(getProviderConnections).mockResolvedValueOnce([]);
    expect((await POST(request(headers, body))).status).toBe(403);
    vi.mocked(resolveConnectionProxyConfig).mockResolvedValueOnce({ strictProxy: true });
    expect((await POST(request(headers, body))).status).toBe(403);
  });

  it("covers official models and applies cooldown only to eligible handshake failures", async () => {
    globalThis[Symbol.for("9router.realtime.internal-secret")] = "process-secret";
    const headers = { "x-9r-realtime-secret": "process-secret", "x-9r-real-ip": "127.0.0.1", authorization: "Bearer client-key" };
    for (const model of require("../../realtime/realtime-models.cjs")) {
      expect((await POST(request(headers, { model }))).status).toBe(200);
    }
    vi.mocked(updateProviderConnection).mockClear();
    expect((await POST(request(headers, { model: "gpt-realtime-2", excluded: ["connection-id"], failure: { connectionId: "connection-id", status: 429 } }))).status).toBe(503);
    expect(updateProviderConnection).toHaveBeenCalledWith("connection-id", expect.objectContaining({ errorCode: 429, lastError: "Realtime upstream handshake failed" }));
    vi.mocked(updateProviderConnection).mockClear();
    expect((await POST(request(headers, { model: "gpt-realtime-2", excluded: ["other"], failure: { connectionId: "other", status: 401 } }))).status).toBe(400);
    expect(updateProviderConnection).not.toHaveBeenCalled();
    expect(getProviderConnections).toHaveBeenCalled();
  });

  it("fails closed when a configured proxy pool is unavailable", async () => {
    globalThis[Symbol.for("9router.realtime.internal-secret")] = "process-secret";
    vi.mocked(resolveConnectionProxyConfig).mockResolvedValue({ source: "none", proxyPoolId: "missing-pool" });
    const response = await POST(request({
      "x-9r-realtime-secret": "process-secret",
      "x-9r-real-ip": "127.0.0.1",
      authorization: "Bearer client-key",
    }));
    vi.mocked(resolveConnectionProxyConfig).mockResolvedValue({});
    expect(response.status).toBe(503);
  });

  it("rejects external or non-loopback callers even with a supplied environment token", async () => {
    globalThis[Symbol.for("9router.realtime.internal-secret")] = "process-secret";
    process.env.NINEROUTER_PEER_TOKEN = "attacker-supplied";

    expect((await POST(request({
      "x-9r-realtime-secret": "attacker-supplied",
      "x-9r-real-ip": "127.0.0.1",
      authorization: "Bearer client-key",
    }))).status).toBe(404);
    expect((await POST(request({
      "x-9r-realtime-secret": "process-secret",
      "x-9r-real-ip": "203.0.113.10",
      authorization: "Bearer client-key",
    }))).status).toBe(404);
  });

  it("uses the actual auth credential-selection path and returns only upstream credentials", async () => {
    globalThis[Symbol.for("9router.realtime.internal-secret")] = "process-secret";
    const response = await POST(request({
      "x-9r-realtime-secret": "process-secret",
      "x-9r-real-ip": "::1",
      authorization: "Bearer client-key",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ apiKey: "provider-secret", connectionId: "connection-id" });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each(["gpt-realtime", "pollinations/openai/gpt-realtime-2.1"])("connects %s through the real loopback route", async (model) => {
    globalThis[Symbol.for("9router.realtime.internal-secret")] = "process-secret";
    let internalRequest;
    let upstream;
    const server = http.createServer(async (request, response) => {
      const chunks = [];
      request.on("data", (chunk) => chunks.push(chunk));
      await once(request, "end");
      internalRequest = { headers: request.headers, body: Buffer.concat(chunks).toString("utf8") };
      const headers = { ...request.headers, "x-9r-real-ip": "127.0.0.1" };
      const middlewareRequest = {
        nextUrl: { pathname: "/api/internal/realtime-credentials", searchParams: new URLSearchParams() },
        headers: new Headers(headers),
        cookies: { get: () => undefined },
        url: "http://127.0.0.1/api/internal/realtime-credentials",
      };
      const middlewareResponse = await dashboardProxy(middlewareRequest);
      if (middlewareResponse.status !== 200) {
        response.writeHead(middlewareResponse.status);
        response.end();
        return;
      }
      const result = await POST(new Request("http://127.0.0.1/api/internal/realtime-credentials", {
        method: "POST",
        headers,
        body: Buffer.concat(chunks),
      }));
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    });
    server.on("upgrade", (request, socket, head) => {
      upgrade(server, request, socket, head, {
        createUpstream: (url, apiKey) => {
          expect(url).toBe(model.startsWith("pollinations/")
            ? "wss://gen.pollinations.ai/v1/realtime?model=openai%2Fgpt-realtime-2.1"
            : "wss://api.openai.com/v1/realtime?model=gpt-realtime");
          expect(apiKey).toBe("provider-secret");
          upstream = {
            readyState: 0,
            bufferedAmount: 0,
            once(event, listener) {
              if (event === "open") queueMicrotask(() => { upstream.readyState = 1; listener(); });
              return upstream;
            },
            on() { return upstream; },
            close() { upstream.readyState = 3; },
          };
          return upstream;
        },
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const client = new WebSocket(`ws://127.0.0.1:${server.address().port}/v1/realtime?model=${encodeURIComponent(model)}`, {
      headers: { authorization: "Bearer client-key" },
    });
    await once(client, "open");
    expect(internalRequest.headers["x-9r-realtime-secret"]).toBe("process-secret");
    expect(internalRequest.headers.authorization).toBe("Bearer client-key");
    expect(JSON.parse(internalRequest.body)).toEqual({ model });
    client.close();
    await once(client, "close");
    server.close();
  });
});