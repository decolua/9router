// node --test open-sse/utils/earlySse.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isCloudflareRequest,
  clientWantsStream,
  createKeepaliveSseResponse,
} from "./earlySse.js";

test("isCloudflareRequest detects cf-ray header (mixed case)", () => {
  assert.equal(isCloudflareRequest({ "cf-ray": "abc" }), true);
  assert.equal(isCloudflareRequest({ "CF-Ray": "abc" }), true);
  assert.equal(isCloudflareRequest({ "cf-connecting-ip": "1.2.3.4" }), true);
  assert.equal(isCloudflareRequest({ "user-agent": "curl" }), false);
  assert.equal(isCloudflareRequest(null), false);
});

test("isCloudflareRequest works with Headers instance", () => {
  const h = new Headers({ "cf-ray": "xyz" });
  assert.equal(isCloudflareRequest(h), true);
});

test("clientWantsStream requires explicit stream flag", () => {
  assert.equal(clientWantsStream({}), false);
  assert.equal(clientWantsStream({ stream: true }), true);
  assert.equal(clientWantsStream({ stream: false }), false);
  assert.equal(clientWantsStream({}, { accept: "application/json" }), false);
  assert.equal(clientWantsStream({}, { accept: "text/event-stream" }), false);
  assert.equal(clientWantsStream({}, new Headers({ accept: "text/event-stream" })), false);
});

test("createKeepaliveSseResponse emits first byte immediately", async () => {
  let resolveWork;
  const workPromise = new Promise((r) => {
    resolveWork = r;
  });

  const res = createKeepaliveSseResponse(async () => {
    await workPromise;
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/event-stream/);
  assert.equal(res.headers.get("x-accel-buffering"), "no");

  const reader = res.body.getReader();
  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);
  assert.match(text, /: connected/);

  resolveWork();
  // drain
  while (true) {
    const r = await reader.read();
    if (r.done) break;
  }
});

test("createKeepaliveSseResponse converts JSON error Response to SSE error event", async () => {
  const res = createKeepaliveSseResponse(async () => {
    return new Response(JSON.stringify({ error: { message: "Provider timed out" } }), {
      status: 504,
      headers: { "Content-Type": "application/json" },
    });
  });
  const reader = res.body.getReader();
  const chunks = [];
  while (true) {
    const r = await reader.read();
    if (r.done) break;
    chunks.push(new TextDecoder().decode(r.value));
  }
  const all = chunks.join("");
  assert.match(all, /: connected/);
  assert.match(all, /Provider timed out/);
  assert.match(all, /\[DONE\]/);
});

test("createKeepaliveSseResponse pipes SSE success body", async () => {
  const upstream = new ReadableStream({
    start(c) {
      c.enqueue(new TextEncoder().encode('data: {"ok":true}\n\n'));
      c.close();
    },
  });
  const res = createKeepaliveSseResponse(async () => {
    return new Response(upstream, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  });
  const reader = res.body.getReader();
  const chunks = [];
  while (true) {
    const r = await reader.read();
    if (r.done) break;
    chunks.push(new TextDecoder().decode(r.value));
  }
  const all = chunks.join("");
  assert.match(all, /: connected/);
  assert.match(all, /"ok":true/);
});
