import assert from "node:assert/strict";
import { createCodexRealtimeBridge } from "../../open-sse/handlers/codexRealtimeBridge.js";
import { synthesizeCodexTts } from "../../open-sse/handlers/codexTts.js";

const proxyKeys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"];
const savedProxy = Object.fromEntries(proxyKeys.map((key) => [key, process.env[key]]));
for (const key of proxyKeys) delete process.env[key];

function event() {
  const listeners = new Set();
  return { subscribe(fn) { listeners.add(fn); return { unSubscribe: () => listeners.delete(fn) }; }, emit(value) { for (const fn of listeners) fn(value); }, get size() { return listeners.size; } };
}
function setup() {
  const channel = { readyState: "open", stateChange: event(), onMessage: event(), sent: [], send(message) { this.sent.push(message); } };
  const peer = { onTrack: event(), addTrack() {}, createDataChannel: () => channel, createOffer: async () => ({}), setLocalDescription: async function () { this.localDescription = { sdp: "v=0" }; }, setRemoteDescription: async () => {}, close: async function () { this.closed = true; } };
  const track = { packets: [], writeRtp(packet) { this.packets.push(packet); }, stop() { this.stopped = true; } };
  return { peer, track, channel, options: { createPeer: () => peer, createTrack: () => track, call: async () => ({ sdp: "v=0" }) } };
}
{
  const { peer, track, options } = setup();
  const bridge = await createCodexRealtimeBridge(options);
  bridge.sendAudio(Uint8Array.of(8, 0));
  assert.equal(track.packets[0].header.timestamp, 0);
  bridge.sendAudio(Uint8Array.of(1, 0));
  assert.equal(track.packets[1].header.timestamp, 960);
  assert.throws(() => bridge.sendAudio(new Uint8Array(4097)));
  assert.throws(() => bridge.sendAudio(Uint8Array.of(8)), /Invalid/);
  assert.throws(() => bridge.sendAudio(Uint8Array.of(0, 0)), /Invalid/);
  assert.throws(() => bridge.sendAudio(Uint8Array.of(3, 0)), /Invalid/);
  for (let i = 0; i < 48; i++) bridge.sendAudio(Uint8Array.of(8, 0));
  assert.throws(() => bridge.sendAudio(Uint8Array.of(8, 0)), /rate limit/);
  const rtp = event();
  peer.onTrack.emit({ kind: "audio", onReceiveRtp: rtp });
  rtp.emit({ header: { sequenceNumber: 7, timestamp: 10 }, payload: Buffer.from([3]) });
  const reader = bridge.audio.getReader();
  assert.equal((await reader.read()).value.sequenceNumber, 7);
  await bridge.close();
  assert.equal((await reader.read()).done, true);
  assert.ok(peer.closed && track.stopped);
  assert.equal(rtp.size, 0);
  assert.throws(() => bridge.sendAudio(Uint8Array.of(8, 0)), /closed/);
}
{
  const { peer, options } = setup();
  const abort = new AbortController();
  const bridge = await createCodexRealtimeBridge({ ...options, signal: abort.signal });
  const reader = bridge.audio.getReader();
  abort.abort(new Error("cancelled"));
  await assert.rejects(reader.read(), /cancelled/);
  await bridge.close();
  assert.ok(peer.closed);
}
{
  const { channel, options } = setup();
  let signal;
  const pending = createCodexRealtimeBridge({ ...options, call: ({ signal: s }) => { signal = s; return new Promise(() => {}); } });
  await new Promise((resolve) => setImmediate(resolve));
  channel.stateChange.emit("closed");
  await assert.rejects(pending);
  assert.equal(signal.aborted, true);
}
{
  const { options } = setup();
  await assert.rejects(createCodexRealtimeBridge({ ...options, proxyOptions: { enabled: true } }), /proxy/);
  for (const proxyOptions of [{ url: "http://proxy" }, { connectionProxyUrl: "http://proxy" }, { proxyPoolId: "pool" }, { source: "error" }]) {
    await assert.rejects(createCodexRealtimeBridge({ ...options, proxyOptions }), /proxy/);
    await assert.rejects(synthesizeCodexTts({ proxyOptions }), /proxy/);
  }
  for (const key of proxyKeys) {
    process.env[key] = "http://proxy";
    await assert.rejects(createCodexRealtimeBridge(options), /proxy/);
    await assert.rejects(synthesizeCodexTts({}), /proxy/);
    delete process.env[key];
  }
  const { peer, options: opts } = setup();
  await assert.rejects(createCodexRealtimeBridge({ ...opts, call: async () => { throw new Error("signaling failed"); } }), /signaling failed/);
  assert.ok(peer.closed);
}
{
  const { peer, track, options } = setup();
  track.stop = () => { throw new Error("stop failed"); };
  const bridge = await createCodexRealtimeBridge(options);
  await bridge.audio.cancel();
  assert.ok(peer.closed);
  await bridge.close();
}
{
  const { peer, options } = setup();
  const abort = new AbortController();
  peer.createOffer = () => new Promise(() => {});
  const pending = createCodexRealtimeBridge({ ...options, signal: abort.signal });
  abort.abort(new Error("setup cancelled"));
  await assert.rejects(pending, /setup cancelled/);
  await Promise.resolve();
  assert.ok(peer.closed);
}
{
  const { peer, options } = setup();
  const bridge = await createCodexRealtimeBridge(options);
  const rtp = event();
  peer.onTrack.emit({ kind: "audio", onReceiveRtp: rtp });
  for (let i = 0; i < 257; i++) rtp.emit({ header: { sequenceNumber: i, timestamp: i }, payload: Buffer.from([1]) });
  await assert.rejects(bridge.audio.getReader().read(), /output exceeds limit/);
  await bridge.close();
  assert.ok(peer.closed);
}
{
  const { peer, channel, options } = setup();
  const bridge = await createCodexRealtimeBridge(options);
  channel.onMessage.emit('{"type":"response.created","id":1}');
  channel.onMessage.emit('{"type":"response.done","id":2}');
  const reader = bridge.events.getReader();
  assert.equal((await reader.read()).value.id, 1);
  assert.equal((await reader.read()).value.id, 2);
  bridge.cancelResponse();
  assert.deepEqual(JSON.parse(channel.sent[0]), { type: "response.cancel" });
  channel.bufferedAmount = 65537;
  assert.throws(() => bridge.cancelResponse(), /backpressure/);
  await reader.cancel();
  assert.ok(peer.closed);
  assert.equal((await bridge.audio.getReader().read()).done, true);
  assert.throws(() => bridge.cancelResponse(), /closed/);
}
{
  const { peer, channel, options } = setup();
  const bridge = await createCodexRealtimeBridge(options);
  for (let i = 0; i < 257; i++) channel.onMessage.emit('{"type":"event"}');
  await assert.rejects(bridge.events.getReader().read(), /output exceeds limit/);
  await assert.rejects(bridge.audio.getReader().read(), /output exceeds limit/);
  await bridge.close();
  assert.ok(peer.closed);
}
for (const [raw, expected] of [['{', /Invalid/], ['[]', /event failed/], ['{"type":"error"}', /event failed/], ['x'.repeat(65537), /exceeds limit/]]) {
  const { channel, options } = setup();
  const bridge = await createCodexRealtimeBridge(options);
  channel.onMessage.emit(raw);
  await assert.rejects(bridge.events.getReader().read(), expected);
  await bridge.close();
}
for (const key of proxyKeys) if (savedProxy[key] !== undefined) process.env[key] = savedProxy[key];
console.log("Codex realtime bridge checks passed");