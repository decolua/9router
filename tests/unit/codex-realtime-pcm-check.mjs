import assert from "node:assert/strict";
import { wrapCodexRealtimePcm } from "../../open-sse/handlers/codexRealtimePcm.js";

let input, closed = 0, timestamp = 0, sequenceNumber = 0, packets = 0;
const bridge = {
  audio: new ReadableStream({ start(c) { input = c; } }),
  events: new ReadableStream(),
  sendAudio(payload) { packets++; input.enqueue({ payload, timestamp, sequenceNumber: sequenceNumber++ }); timestamp += 960; },
  cancelResponse() {},
  async close() { closed++; },
};
const pcm = wrapCodexRealtimePcm(bridge);
const reader = pcm.audio.getReader();
assert.throws(() => pcm.sendAudio(Buffer.alloc(3)));
const deadline = AbortSignal.timeout(10000);
const reading = reader.read();
for (let i = 0; i < 150; i++) {
  const samples = Buffer.alloc(960);
  for (let j = 0; j < 480; j++) samples.writeInt16LE(Math.round(12000 * Math.sin(2 * Math.PI * 440 * (i * 480 + j) / 24000)), j * 2);
  pcm.sendAudio(samples);
  await new Promise((resolve) => setTimeout(resolve, 20));
}
const result = await Promise.race([reading, new Promise((_, reject) => deadline.addEventListener("abort", () => reject(new Error("PCM stream timed out")), { once: true }))]);
assert.ok(packets > 0 && result.value.length > 0 && result.value.length % 2 === 0);
assert.ok(result.value.some((byte) => byte !== 0), "decoded audio must not be silent");
await reader.cancel();
await pcm.close();
assert.equal(closed, 1);
console.log("PCM streaming check passed");