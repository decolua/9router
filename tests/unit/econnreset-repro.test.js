// Reproduce the production failure Claude Code reports through 9router:
//   [502]: fetch failed (cause: ECONNRESET: read ECONNRESET)
// Three failure phases behave differently — this file pins each one against the
// real transport stack (BaseExecutor + proxyAwareFetch + formatProviderError):
//   A. request-phase reset (upstream RSTs before response headers) → undici
//      "fetch failed"/ECONNRESET, retried by the 502 retry config, formatted
//      into the exact production string.
//   B. read-phase reset (stream dies mid-body) → execute() already returned
//      200, the body read rejects — no retry layer covers this.
//   C. dead proxy → proxyAwareFetch falls back to direct unless the channel
//      pins strictProxy, in which case it refuses to leak the direct path.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { BaseExecutor } from "../../open-sse/executors/base.js";
import { formatProviderError } from "../../open-sse/utils/error.js";
import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";

// proxyAwareFetch honors env proxies — keep the dev machine's out of the loop
const ENV_KEYS = ["HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy", "NO_PROXY", "no_proxy"];
const savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
for (const k of ENV_KEYS) process.env[k] = undefined;
process.env.NO_PROXY = "*";

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

const BODY = { model: "claude-sonnet-5-5", stream: false, messages: [{ role: "user", content: "hi" }] } ;

function makeExecutor(baseUrl) {
  return new BaseExecutor("claude", {
    baseUrl,
    retry: { 502: { attempts: 3, delayMs: 0 } },
  });
}

let rstServer, rstUrl, rstHits;
let midServer, midUrl, midHits;
let okServer, okUrl;
let proxyServer, proxyUrl, proxyHits;

beforeAll(async () => {
  // A: swallow the request, then RST before a single response byte.
  // resetAndDestroy() sends a real RST — plain destroy() is a FIN and undici
  // surfaces that as UND_ERR_SOCKET "other side closed" instead.
  rstHits = 0;
  rstServer = http.createServer((req, res) => {
    rstHits++;
    req.on("end", () => res.socket.resetAndDestroy());
    req.resume();
  });
  await listen(rstServer);
  rstUrl = `http://127.0.0.1:${rstServer.address().port}/v1/messages`;

  // B: 200 + one SSE chunk, then RST mid-stream
  midHits = 0;
  midServer = http.createServer((req, res) => {
    midHits++;
    req.on("end", () => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"type":"message_start"}\n\n');
      setTimeout(() => res.socket.resetAndDestroy(), 20);
    });
    req.resume();
  });
  await listen(midServer);
  midUrl = `http://127.0.0.1:${midServer.address().port}/v1/messages`;

  // healthy upstream for the proxy-fallback scenario
  okServer = http.createServer((req, res) => {
    req.resume();
    req.on("end", () => res.end(JSON.stringify({ ok: true })));
  });
  await listen(okServer);
  okUrl = `http://127.0.0.1:${okServer.address().port}/v1/messages`;

  // C: proxy that answers CONNECT with 2xx then RSTs the tunnel.
  // undici ProxyAgent tunnels even http targets through CONNECT.
  proxyHits = 0;
  proxyServer = http.createServer((req, res) => {
    proxyHits++;
    res.socket.resetAndDestroy();
  });
  proxyServer.on("connect", (req, clientSocket) => {
    proxyHits++;
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    clientSocket.resetAndDestroy();
  });
  await listen(proxyServer);
  proxyUrl = `http://127.0.0.1:${proxyServer.address().port}`;
});

afterAll(async () => {
  Object.assign(process.env, savedEnv);
  await Promise.all([rstServer, midServer, okServer, proxyServer].map(close));
});

describe("A. request-phase ECONNRESET (RST before response headers)", () => {
  it("retries per the 502 retry config, then surfaces the production error string", async () => {
    const ex = makeExecutor(rstUrl);
    let caught;
    try {
      await ex.execute({ model: BODY.model, body: BODY, stream: false, credentials: { accessToken: "tok" } });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeTruthy();
    expect(caught.message).toBe("fetch failed");
    expect(caught.cause?.code).toBe("ECONNRESET");
    expect(rstHits).toBe(4); // 1 attempt + 3 retries — the retry layer already ran

    expect(formatProviderError(caught, "claude", BODY.model, 502))
      .toBe("[502]: fetch failed (cause: ECONNRESET: read ECONNRESET)");
  });

  it("with retries disabled, fails on the first attempt", async () => {
    const ex = new BaseExecutor("claude", { baseUrl: rstUrl, retry: { 502: { attempts: 0, delayMs: 0 } } });
    await expect(
      ex.execute({ model: BODY.model, body: BODY, stream: false, credentials: { accessToken: "tok" } }),
    ).rejects.toMatchObject({ message: "fetch failed" });
    expect(rstHits).toBe(5); // 4 from the case above + 1 here
  });
});

describe("B. read-phase ECONNRESET (stream dies mid-body)", () => {
  it("is NOT retried — execute() returns 200 and the body read rejects", async () => {
    const ex = makeExecutor(midUrl);
    const result = await ex.execute({ model: BODY.model, body: BODY, stream: true, credentials: { accessToken: "tok" } });

    expect(result.response.status).toBe(200); // executor is done — no retry layer left
    await expect(result.response.text()).rejects.toThrow(/terminated|ECONNRESET|aborted/i);
    expect(midHits).toBe(1); // nothing ever reconnected
  });
});

describe("C. dead proxy", () => {
  it("falls back to direct and succeeds when the channel is not strict", async () => {
    const res = await proxyAwareFetch(okUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(BODY),
    }, { enabled: true, url: proxyUrl });

    expect(res.status).toBe(200);
    expect(proxyHits).toBeGreaterThan(0); // the proxy leg really ran and died
  });

  it("refuses the direct fallback when strictProxy is pinned", async () => {
    await expect(proxyAwareFetch(okUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(BODY),
    }, { enabled: true, url: proxyUrl, strictProxy: true })).rejects.toThrow(/strictProxy/);
  });
});
