import assert from "node:assert/strict";
import { handleTtsCore } from "../../open-sse/handlers/ttsCore.js";

const originalFetch = globalThis.fetch;
let sent;
globalThis.fetch = async (_url, options) => {
  sent = JSON.parse(options.body);
  return new Response(Buffer.from([0, 0, 255, 127]));
};
try {
  const args = { provider: "selfhosted-tts", model: "test", input: "hello", upstreamFormat: "pcm" };
  const wav = await handleTtsCore({ ...args, responseFormat: "wav" });
  assert.equal(sent.response_format, "pcm");
  assert.equal(wav.response.headers.get("content-type"), "audio/wav");
  const bytes = Buffer.from(await wav.response.arrayBuffer());
  assert.equal(bytes.toString("ascii", 0, 4), "RIFF");
  assert.equal(bytes.readUInt32LE(24), 24000);
  assert.deepEqual(bytes.subarray(44), Buffer.from([0, 0, 255, 127]));
  const stereo = await handleTtsCore({ ...args, upstreamFormat: "pcm_48000_2", responseFormat: "wav" });
  const stereoBytes = Buffer.from(await stereo.response.arrayBuffer());
  assert.equal(sent.response_format, "pcm");
  assert.equal(stereoBytes.readUInt16LE(22), 2);
  assert.equal(stereoBytes.readUInt32LE(24), 48000);
  assert.equal(stereoBytes.readUInt32LE(28), 192000);
  const json = await handleTtsCore({ ...args, responseFormat: "json" });
  const jsonBody = await json.response.json();
  assert.equal(jsonBody.format, "wav");
  assert.equal(Buffer.from(jsonBody.audio, "base64").toString("ascii", 0, 4), "RIFF");
  assert.equal((await handleTtsCore({ ...args, responseFormat: "pcm" })).status, 400);
  const mp3 = await handleTtsCore({ ...args, responseFormat: "mp3" });
  assert.equal(mp3.success, true);
  assert.equal(mp3.response.headers.get("content-type"), "audio/mpeg");
  assert.ok((await mp3.response.arrayBuffer()).byteLength > 4);
  assert.equal((await handleTtsCore({ ...args, upstreamFormat: "invalid" })).status, 400);
  globalThis.fetch = async (_url, options) => {
    sent = JSON.parse(options.body);
    return new Response('data: {"choices":[{"delta":{"audio":{"data":"AAA="}}}]}\n' +
      'data: {"choices":[{"delta":{"audio":{"data":"/38="}}}]}\n');
  };
  const router = await handleTtsCore({ provider: "openrouter", model: "vendor/model", input: "hello", credentials: { apiKey: "test" }, upstreamFormat: "pcm", responseFormat: "wav" });
  assert.equal(sent.audio.format, "pcm");
  assert.deepEqual(Buffer.from(await router.response.arrayBuffer()).subarray(44), Buffer.from([0, 0, 255, 127]));
  assert.equal((await handleTtsCore({ provider: "gemini", model: "test", input: "hello", upstreamFormat: "pcm" })).status, 400);
} finally {
  globalThis.fetch = originalFetch;
}