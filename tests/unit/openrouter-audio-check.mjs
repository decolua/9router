import assert from "node:assert/strict";
import { mock } from "node:test";

// Run: node --experimental-test-module-mocks tests/unit/openrouter-audio-check.mjs

let request;
let dedicatedSpeech = false;
const fetchMock = async (url, options) => {
  request = { url, ...options, body: JSON.parse(options.body) };
  if (dedicatedSpeech && url.endsWith("/chat/completions")) return Response.json({ error: { message: "Use the /api/v1/audio/speech endpoint instead." } }, { status: 400 });
  if (url.endsWith("/audio/speech")) return new Response("audio");
  if (request.body.stream) return new Response('data: {"choices":[{"delta":{"audio":{"data":"aGk="}}}]}\n\ndata: [DONE]\n\n');
  return Response.json({ choices: [{ message: { content: "Hello" } }] });
};
globalThis.fetch = fetchMock;
mock.module("../../open-sse/utils/proxyFetch.js", { namedExports: { proxyAwareFetch: fetchMock } });
const { handleSttCore } = await import("../../open-sse/handlers/sttCore.js");
const { handleTtsCore } = await import("../../open-sse/handlers/ttsCore.js");
const { PROVIDER_MEDIA } = await import("../../open-sse/providers/index.js");
const formData = new FormData();
formData.set("file", new Blob(["audio"], { type: "audio/mpeg" }), "test.mp3");
const args = { provider: "openrouter", model: "vendor/audio-model", formData, credentials: { apiKey: "secret", providerSpecificData: { baseUrl: "https://attacker.invalid" } }, sttConfig: PROVIDER_MEDIA.openrouter.sttConfig };
let result = await handleSttCore(args);
assert.deepEqual(await result.response.json(), { text: "Hello" });
assert.equal(request.url, "https://openrouter.ai/api/v1/chat/completions");
assert.equal(request.body.model, "vendor/audio-model");
assert.deepEqual(request.body.messages[0].content[1].input_audio, { data: "YXVkaW8=", format: "mp3" });
formData.set("response_format", "text");
result = await handleSttCore(args);
assert.equal(await result.response.text(), "Hello");
formData.set("response_format", "srt");
assert.equal((await handleSttCore(args)).status, 400);
result = await handleTtsCore({ provider: "openrouter", model: "vendor/custom-model", voice: "custom-voice", input: "Hello", credentials: { apiKey: "secret" }, responseFormat: "json" });
assert.equal(result.success, true);
assert.equal(request.body.model, "vendor/custom-model");
assert.equal(request.body.audio.voice, "custom-voice");
dedicatedSpeech = true;
result = await handleTtsCore({ provider: "openrouter", model: "heygen/heygen-voice-1-turbo:free", voice: "voice-id", input: "Hello", credentials: { apiKey: "secret" }, responseFormat: "json" });
assert.equal(result.success, true);
assert.equal(request.url, "https://openrouter.ai/api/v1/audio/speech");
assert.deepEqual(request.body, { model: "heygen/heygen-voice-1-turbo:free", input: "Hello", voice: "voice-id", response_format: "mp3" });
assert.deepEqual(await result.response.json(), { audio: "YXVkaW8=", format: "mp3" });