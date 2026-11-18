import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";
import { EventEmitter, once } from "node:events";

const require = createRequire(import.meta.url);
const { WebSocket } = require("ws");
const upgrade = require("../../realtime/openai-realtime-websocket.js");

// Disconnected clients must not retain the limited slots while authorization hangs.
const pendingSockets = [];
const pendingRequest = { method: "GET", url: "/v1/realtime?model=gpt-realtime", headers: {
  upgrade: "websocket", connection: "Upgrade", "sec-websocket-version": "13", "sec-websocket-key": "AAAAAAAAAAAAAAAAAAAAAA==", authorization: "Bearer invalid",
} };
const missingAuth = new EventEmitter();
missingAuth.end = (response) => assert.match(response, /401/);
upgrade(null, { ...pendingRequest, headers: { ...pendingRequest.headers, authorization: undefined } }, missingAuth, Buffer.alloc(0));
for (let i = 0; i < upgrade._constants.MAX_SESSIONS; i++) {
  const socket = new EventEmitter();
  socket.remoteAddress = `192.0.2.${i}`;
  socket.end = () => assert.fail("session unexpectedly rejected");
  pendingSockets.push(socket);
  upgrade(null, pendingRequest, socket, Buffer.alloc(0), { resolve: () => new Promise(() => {}) });
}
const globallyExcess = new EventEmitter();
globallyExcess.remoteAddress = "192.0.2.200";
globallyExcess.end = (response) => assert.match(response, /503/);
upgrade(null, pendingRequest, globallyExcess, Buffer.alloc(0));
pendingSockets.forEach((socket) => socket.emit("close"));
const replacement = new EventEmitter();
replacement.remoteAddress = "192.0.2.1";
replacement.end = () => assert.fail("disconnected sessions retained their slots");
upgrade(null, pendingRequest, replacement, Buffer.alloc(0), { resolve: () => new Promise(() => {}) });
replacement.emit("close");

const blocked = new EventEmitter();
blocked.remoteAddress = "192.0.2.100";
blocked.end = () => {};
const held = [blocked, new EventEmitter()];
held[1].remoteAddress = blocked.remoteAddress;
held[1].end = () => {};
for (const socket of held) upgrade(null, pendingRequest, socket, Buffer.alloc(0), { resolve: () => new Promise(() => {}) });
const excess = new EventEmitter();
excess.remoteAddress = blocked.remoteAddress;
excess.end = (response) => assert.match(response, /503/);
upgrade(null, pendingRequest, excess, Buffer.alloc(0));
held.forEach((socket) => socket.emit("close"));

class FakeUpstream {
  constructor() {
    this.readyState = 0;
    this.bufferedAmount = 0;
    this.sent = [];
    this.listeners = new Map();
  }
  once(event, listener) { this.listeners.set(event, [listener]); return this; }
  on(event, listener) { this.listeners.set(event, [...(this.listeners.get(event) || []), listener]); return this; }
  emit(event, ...args) { for (const listener of this.listeners.get(event) || []) listener(...args); }
  send(data) {
    const payload = Buffer.from(data);
    this.sent.push(payload);
    this.emit("sent", payload);
  }
  close(code, reason) { this.readyState = 3; this.closeCode = code; this.closeReason = reason; this.emit("close", code, reason); }
  terminate() { this.readyState = 3; this.terminated = true; }
}

let upstream;
let resolved;
let authorized = true;
const server = http.createServer();
server.on("upgrade", (req, socket, head) => {
  const handled = upgrade(server, req, socket, head, {
    revalidateMs: 20,
    resolve: async (request, model, validateOnly) => {
      if (validateOnly) return { valid: authorized };
      resolved = { authorization: request.headers.authorization, model };
      if (request.headers.authorization !== "Bearer local-key") return { status: 401 };
      return { apiKey: "upstream-secret" };
    },
    createUpstream: (url, apiKey) => {
      assert.equal(url, "wss://api.openai.com/v1/realtime?model=gpt-realtime");
      assert.equal(apiKey, "upstream-secret");
      upstream = new FakeUpstream();
      queueMicrotask(() => { upstream.readyState = 1; upstream.emit("open"); });
      return upstream;
    },
  });
  if (!handled) socket.end("HTTP/1.1 418 Delegated\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const url = `ws://127.0.0.1:${server.address().port}/v1/realtime?model=gpt-realtime`;

const unauthorized = new WebSocket(url, { headers: { authorization: "Bearer wrong" } });
unauthorized.on("error", () => {});
assert.equal((await once(unauthorized, "unexpected-response"))[1].statusCode, 401);

const unsupported = new WebSocket(url.replace("gpt-realtime", "not-a-realtime-model"), { headers: { authorization: "Bearer local-key" } });
unsupported.on("error", () => {});
assert.equal((await once(unsupported, "unexpected-response"))[1].statusCode, 400);

const codex = new WebSocket(url.replace("gpt-realtime", "cx%2Fgpt-live-1-codex"), { headers: { authorization: "Bearer local-key" } });
codex.on("error", () => {});
assert.equal((await once(codex, "unexpected-response"))[1].statusCode, 418);

const otherPath = new WebSocket(url.replace("/v1/realtime?", "/v1/realtime-extra?"));
otherPath.on("error", () => {});
assert.equal((await once(otherPath, "unexpected-response"))[1].statusCode, 418);

const client = new WebSocket(url, { headers: { authorization: "Bearer local-key" } });
await once(client, "open");
assert.deepEqual(resolved, { authorization: "Bearer local-key", model: "gpt-realtime" });

const received = once(client, "message");
upstream.emit("message", Buffer.from('{"type":"session.created","session":{}}'), false);
assert.equal((await received)[0].toString(), '{"type":"session.created","session":{}}');

const forwarded = once(upstream, "sent");
client.send('{"type":"input_audio_buffer.append","audio":"AQI="}');
await forwarded;
assert.deepEqual(upstream.sent, [Buffer.from('{"type":"input_audio_buffer.append","audio":"AQI="}')]);

upstream.bufferedAmount = upgrade._constants.MAX_BUFFERED_BYTES + 1;
client.send('{"type":"input_audio_buffer.append","audio":"AQI="}');
await once(client, "close");

const qualified = new WebSocket(url.replace("gpt-realtime", "openai%2Fgpt-realtime"), { headers: { authorization: "Bearer local-key" } });
await once(qualified, "open");
assert.equal(resolved.model, "gpt-realtime");
qualified.close();
await once(qualified, "close");

const afterBackpressure = new WebSocket(url, { headers: { authorization: "Bearer local-key" } });
await once(afterBackpressure, "open");
const upstreamClosed = once(upstream, "close");
afterBackpressure.close(1000, "done");
await once(afterBackpressure, "close");
await upstreamClosed;
assert.equal(upstream.closeCode, 1000);
assert.equal(upstream.closeReason.toString(), "done");

const revoked = new WebSocket(url, { headers: { authorization: "Bearer local-key" } });
await once(revoked, "open");
authorized = false;
assert.equal((await once(revoked, "close"))[0], 1008);

server.close();

const attempts = [];
let failedUpstream;
let responseDestroyed = false;
const fallbackServer = http.createServer();
fallbackServer.on("upgrade", (req, socket, head) => upgrade(fallbackServer, req, socket, head, {
  resolve: async (_req, _model, _validate, retry) => {
    attempts.push(retry);
    return retry ? { apiKey: "second", connectionId: "b" } : { apiKey: "first", connectionId: "a" };
  },
  createUpstream: (_url, key) => {
    const ws = new FakeUpstream();
    queueMicrotask(() => {
      if (key === "first") {
        failedUpstream = ws;
        ws.emit("unexpected-response", null, { statusCode: 429, destroy() { responseDestroyed = true; } });
      }
      else { ws.readyState = 1; ws.emit("open"); }
    });
    return ws;
  },
}));
fallbackServer.listen(0, "127.0.0.1");
await once(fallbackServer, "listening");
const fallback = new WebSocket(`ws://127.0.0.1:${fallbackServer.address().port}/v1/realtime?model=gpt-realtime-2`, { headers: { authorization: "Bearer local-key" } });
await once(fallback, "open");
assert.deepEqual(attempts, [null, { excluded: ["a"], failure: { connectionId: "a", status: 429 } }]);
assert.equal(responseDestroyed, true);
assert.equal(failedUpstream.terminated, true);
fallback.close();
await once(fallback, "close");
fallbackServer.close();
console.log("openai realtime websocket checks passed");