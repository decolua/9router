import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { startAdmission } from "open-sse/executors/claudeCliAdmission.js";

/**
 * The relay as a running thing, not just its rewrite rule.
 *
 * pinMessageBreakpoint has its own tests, but a correct rule in a relay nothing
 * reaches is worth nothing — and the end-to-end check could not catch that: its
 * stand-in CLI prints canned JSON and never makes an HTTP request, so it passed
 * 16/16 with the relay never once contacted. These drive the socket.
 *
 * The upstream here is a loopback fixture, which startAdmission allows for
 * exactly this purpose; a real one must be HTTPS.
 */

const open = [];
afterEach(() => {
  while (open.length) {
    const item = open.pop();
    try { item.close(); } catch { /* already closed */ }
  }
});

/** An upstream that records what reached it and answers with a fixed body. */
async function fixture({ status = 200, body = '{"ok":true}' } = {}) {
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      received.push({
        url: req.url,
        method: req.method,
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      res.writeHead(status, { "content-type": "application/json" });
      res.end(body);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  open.push(server);
  return { received, url: `http://127.0.0.1:${server.address().port}` };
}

function post(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      path: target.pathname,
      method: "POST",
      headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload), ...headers },
    }, (res) => {
      let out = "";
      res.on("data", (d) => { out += d; });
      res.on("end", () => resolve({ status: res.statusCode, body: out }));
    });
    req.on("error", reject);
    req.end(payload);
  });
}

const CONVERSATION = {
  messages: [
    { role: "user", content: [{ type: "text", text: "q1" }] },
    { role: "assistant", content: [{ type: "text", text: "a1" }] },
    {
      role: "user",
      content: [
        { type: "text", text: "ours" },
        { type: "text", text: "the CLI's reminder", cache_control: { type: "ephemeral" } },
      ],
    },
  ],
};

describe("the admission relay, running", () => {
  it("forwards a request to the upstream and the answer back", async () => {
    const upstream = await fixture({ body: '{"answered":true}' });
    const relay = await startAdmission({ upstream: upstream.url, queried: [{ type: "text", text: "ours" }] });
    open.push(relay);

    const res = await post(`${relay.url}/v1/messages`, JSON.stringify(CONVERSATION));
    expect(res.status).toBe(200);
    expect(res.body).toBe('{"answered":true}');
    expect(upstream.received).toHaveLength(1);
    expect(upstream.received[0].url).toBe("/v1/messages");
  });

  it("moves the breakpoint on the way through", async () => {
    const upstream = await fixture();
    const relay = await startAdmission({ upstream: upstream.url, queried: [{ type: "text", text: "ours" }] });
    open.push(relay);

    await post(`${relay.url}/v1/messages`, JSON.stringify(CONVERSATION));
    const arrived = JSON.parse(upstream.received[0].body);
    // Onto our own block of the newest turn, off the CLI's reminder.
    expect(arrived.messages[2].content[0].cache_control).toEqual({ type: "ephemeral" });
    expect(arrived.messages[2].content[1].cache_control).toBeUndefined();
    expect(relay.stats().pinned).toBe(1);
  });

  it("passes the caller's own headers upstream, unread", async () => {
    const upstream = await fixture();
    const relay = await startAdmission({ upstream: upstream.url, queried: [{ type: "text", text: "ours" }] });
    open.push(relay);

    await post(`${relay.url}/v1/messages`, JSON.stringify(CONVERSATION), {
      authorization: "Bearer not-a-real-token",
      "anthropic-version": "2023-06-01",
    });
    expect(upstream.received[0].headers.authorization).toBe("Bearer not-a-real-token");
    expect(upstream.received[0].headers["anthropic-version"]).toBe("2023-06-01");
    // Rewritten so the upstream cannot answer with something this hop would
    // have to decompress before the child sees it.
    expect(upstream.received[0].headers["accept-encoding"]).toBe("identity");
  });

  it("refuses a path that does not carry the secret prefix", async () => {
    const upstream = await fixture();
    const relay = await startAdmission({ upstream: upstream.url, queried: [{ type: "text", text: "ours" }] });
    open.push(relay);

    const res = await post(`http://127.0.0.1:${new URL(relay.url).port}/v1/messages`, "{}");
    expect(res.status).toBe(404);
    expect(upstream.received).toHaveLength(0);
    expect(relay.stats().refused).toBe(1);
  });

  it("refuses any path but /v1/messages, as the plugin does", async () => {
    const upstream = await fixture();
    const relay = await startAdmission({ upstream: upstream.url, queried: [{ type: "text", text: "ours" }] });
    open.push(relay);

    const res = await post(`${relay.url}/v1/messages/count_tokens`, JSON.stringify(CONVERSATION));
    expect(res.status).toBe(404);
    expect(upstream.received).toHaveLength(0);
  });

  it("carries a second model call rather than refusing it", async () => {
    // The plugin caps this at one. Measured against a real subscription, some
    // routed requests make a second call — and refusing it does not just fail
    // that request: 9Router reads the refusal as an upstream 4xx, marks the
    // account unavailable and locks it for thirty seconds, so one denial
    // cascades into everything behind it. 20/28 with the cap, 28/28 without.
    const upstream = await fixture();
    const relay = await startAdmission({ upstream: upstream.url, queried: [{ type: "text", text: "ours" }] });
    open.push(relay);

    const first = await post(`${relay.url}/v1/messages`, JSON.stringify(CONVERSATION));
    const second = await post(`${relay.url}/v1/messages`, JSON.stringify(CONVERSATION));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(upstream.received).toHaveLength(2);
    expect(relay.stats().admitted).toBe(2);
  });

  it("refuses a reachability probe rather than forwarding it", async () => {
    // `HEAD /api/hello`, which the child proceeds without.
    const upstream = await fixture();
    const relay = await startAdmission({ upstream: upstream.url, queried: [{ type: "text", text: "ours" }] });
    open.push(relay);

    const status = await new Promise((resolve, reject) => {
      const target = new URL(`${relay.url}/api/hello`);
      const req = http.request({
        hostname: target.hostname, port: target.port, path: target.pathname, method: "HEAD",
      }, (res) => { res.resume(); resolve(res.statusCode); });
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(404);
    expect(upstream.received).toHaveLength(0);
  });

  it("passes an upstream refusal through as it came", async () => {
    const upstream = await fixture({ status: 429, body: '{"error":{"message":"rate limited"}}' });
    const relay = await startAdmission({ upstream: upstream.url, queried: [{ type: "text", text: "ours" }] });
    open.push(relay);

    const res = await post(`${relay.url}/v1/messages`, JSON.stringify(CONVERSATION));
    expect(res.status).toBe(429);
    expect(res.body).toContain("rate limited");
  });

  it("records why an unreachable upstream failed, and closes rather than answering", async () => {
    // As the plugin does: the relay never invents an answer in the upstream's
    // place. What went wrong is readable from stats(), which is where the
    // caller logs it — otherwise a relay fault is indistinguishable from a
    // network one.
    const relay = await startAdmission({ upstream: "http://127.0.0.1:1", queried: [{ type: "text", text: "ours" }] });
    open.push(relay);

    await expect(post(`${relay.url}/v1/messages`, JSON.stringify(CONVERSATION))).rejects.toThrow();
    expect(relay.stats().failure).toBeTruthy();
    expect(relay.stats().forwarded).toBe(0);
  });

  it("stops listening when closed, so a request leaves no socket behind", async () => {
    const upstream = await fixture();
    const relay = await startAdmission({ upstream: upstream.url, queried: [{ type: "text", text: "ours" }] });
    const { url } = relay;
    relay.close();
    await new Promise((r) => setTimeout(r, 50));
    await expect(post(`${url}/v1/messages`, "{}")).rejects.toThrow();
  });

  it("listens on loopback only", async () => {
    const upstream = await fixture();
    const relay = await startAdmission({ upstream: upstream.url, queried: [{ type: "text", text: "ours" }] });
    open.push(relay);
    expect(new URL(relay.url).hostname).toBe("127.0.0.1");
    // And behind a path nothing else can guess.
    expect(new URL(relay.url).pathname).toMatch(/^\/admit\/[A-Za-z0-9_-]{20,}$/);
  });

  it("will not relay to a plaintext upstream that is not loopback", async () => {
    await expect(startAdmission({ upstream: "http://example.com" })).rejects.toThrow(/HTTPS/);
  });
});
