import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import nextConfig from "../../next.config.mjs";
import { createRealtimeSessions } from "../../src/sse/handlers/realtimeSessions.js";

assert.ok(existsSync(new URL("../../src/app/api/v1/codex-voice/route.js", import.meta.url)));
assert.ok(!existsSync(new URL("../../src/app/api/v1/realtime/route.js", import.meta.url)));
assert.ok((await nextConfig.rewrites()).some(({ source, destination }) => source === "/v1/:path*" && destination === "/api/v1/:path*"));

let active = true, allowed = true, closed = 0, packet;
let audioController, eventController;
const handle = createRealtimeSessions({
  authenticate: async (request) => active && request.headers.get("authorization") === "Bearer key" ? "key-id" : null,
  authorize: async () => allowed ? null : new Response(null, { status: 403 }),
  connect: async () => ({
    audio: new ReadableStream({ start(c) { audioController = c; } }),
    events: new ReadableStream({ start(c) { eventController = c; } }),
    sendAudio(data) { packet = data; },
    cancelResponse() {},
    async close() { closed++; try { audioController.close(); eventController.close(); } catch {} },
  }),
});
const req = (url, options = {}) => new Request(`http://localhost/v1/codex-voice${url}`, { method: "POST", headers: { authorization: "Bearer key" }, ...options });
assert.equal((await handle(req("", { headers: {} }))).status, 401);
allowed = false;
assert.equal((await handle(req(""))).status, 403);
allowed = true;
const response = await handle(req(""));
assert.equal(response.status, 200);
const reader = response.body.getReader();
const first = JSON.parse(new TextDecoder().decode((await reader.read()).value));
const id = first.id;
assert.equal(first.type, "session");
assert.equal((await handle(req(`?session=${id}&action=audio`, { body: new Uint8Array([8, 1]) }))).status, 204);
assert.deepEqual([...packet], [8, 1]);
for (let i = 0; i < 10; i++) assert.equal((await handle(req(`?session=${id}&action=cancel`))).status, 204);
assert.equal((await handle(req(`?session=${id}&action=cancel`))).status, 429);
assert.equal((await handle(req(`?session=${id}&action=audio`, { body: new Uint8Array(4097) }))).status, 413);
let uploadController;
const slow = new ReadableStream({ start(c) { uploadController = c; } });
const upload = handle(req(`?session=${id}&action=audio`, { body: slow, duplex: "half" }));
await new Promise((resolve) => setImmediate(resolve));
assert.equal((await handle(req(`?session=${id}&action=audio`, { body: new Uint8Array([8, 1]) }))).status, 429);
uploadController.enqueue(new Uint8Array([8, 1]));
assert.equal((await handle(req(`?session=${id}`, { headers: { authorization: "Bearer other" } }))).status, 401);
allowed = false;
assert.equal((await handle(req(`?session=${id}&action=cancel`))).status, 403);
assert.notEqual((await upload).status, 204);
assert.equal(closed, 1);
await reader.cancel();
active = false;
assert.equal((await handle(req(""))).status, 401);
{
  let audio;
  const failureHandle = createRealtimeSessions({
    authenticate: async () => "key", authorize: async () => null,
    connect: async () => ({ audio: new ReadableStream({ start(c) { audio = c; } }), events: new ReadableStream(), close: async () => {} }),
  });
  const stream = (await failureHandle(req("?format=pcm16"))).body.getReader();
  await stream.read();
  audio.error(new Error("codec failed"));
  await assert.rejects(stream.read(), /codec failed/);
}
{
  const stalledHandle = createRealtimeSessions({
    authenticate: async () => "key", authorize: async () => null,
    connect: async () => ({ audio: new ReadableStream(), events: new ReadableStream(), close: async () => {} }),
  });
  const stream = (await stalledHandle(req(""))).body.getReader();
  const { id } = JSON.parse(new TextDecoder().decode((await stream.read()).value));
  assert.equal((await stalledHandle(req(`?session=${id}`, { method: "DELETE" }))).status, 204);
  assert.equal((await stream.read()).done, true);
}
{
  let finish, lateClosed = 0;
  const abort = new AbortController();
  const pendingHandle = createRealtimeSessions({ authenticate: async () => "key", authorize: async () => null, connect: () => new Promise((resolve) => { finish = resolve; }) });
  const pending = pendingHandle(req("", { signal: abort.signal }));
  await new Promise((resolve) => setImmediate(resolve));
  abort.abort();
  assert.equal((await pending).status, 502);
  finish({ close: async () => { lateClosed++; } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lateClosed, 1);
}
console.log("realtime session checks passed");