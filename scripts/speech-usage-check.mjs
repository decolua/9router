import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Run: node scripts/speech-usage-check.mjs
// Replace only the DB import so this check cannot write to the operator's DB.
const entries = [];
globalThis.__speechUsageCheckSave = async (entry) => entries.push(entry);
const source = await readFile(new URL("../src/sse/handlers/speechUsage.js", import.meta.url), "utf8");
const { runSpeechInference } = await import(`data:text/javascript;base64,${Buffer.from(source.replace(
  'import { saveRequestUsage } from "@/lib/usageDb.js";',
  'const saveRequestUsage = globalThis.__speechUsageCheckSave;'
)).toString("base64")}`);
delete globalThis.__speechUsageCheckSave;
const context = { apiKey: "client-key", endpoint: "/v1/audio/speech" };
const options = { provider: "gemini", model: "tts-model", credentials: { connectionId: "account", apiKey: "upstream-secret" }, input: "private text" };
const response = new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "audio/mpeg" } });
const result = await runSpeechInference(async ({ onUsage }) => {
  onUsage({ prompt_tokens: 9, completion_tokens: 17, audio: "secret-base64", text: "private text" });
  return { success: true, response };
}, options, context);
assert.equal(result.response, response);
assert.equal(response.bodyUsed, false);
assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [1, 2, 3]);
assert.deepEqual(entries[0].tokens, { prompt_tokens: 9, completion_tokens: 17 });
assert.equal(entries[0].connectionId, "account");
assert.equal(entries[0].apiKey, "client-key");
assert.equal(entries[0].endpoint, "/v1/audio/speech");
assert.equal(entries[0].status, "success");
assert.equal(typeof entries[0].latencyMs, "number");
assert.ok(Number.isFinite(Date.parse(entries[0].timestamp)));
assert.ok(!JSON.stringify(entries).includes("upstream-secret"));
assert.ok(!JSON.stringify(entries).includes("private text"));

const failure = { success: false, status: 429, error: "rate limited" };
assert.equal(await runSpeechInference(async () => failure, options, context), failure);
assert.equal(entries[1].status, "error");
assert.deepEqual(entries[1].tokens, {});
await assert.rejects(runSpeechInference(async () => { throw new Error("transport failure"); }, options, context), /transport failure/);
assert.equal(entries[2].status, "error");

// Credential refresh/account fallback are separate invocations, even in one millisecond.
const oldNow = Date.now;
Date.now = () => 1234567890000;
try {
  for (let i = 0; i < 2; i++) {
    await runSpeechInference(async ({ onUsage }) => {
      onUsage({ prompt_tokens: 99, estimated: true });
      return { success: true };
    }, { provider: "google-tts", model: "en" }, context);
  }
} finally {
  Date.now = oldNow;
}
assert.equal(entries.length, 5);
assert.equal(new Set(entries.map((entry) => entry.requestId)).size, 5);
assert.deepEqual(entries[3].tokens, {});
assert.equal(entries[3].connectionId, undefined);
assert.equal(entries[3].timestamp, entries[4].timestamp);
await runSpeechInference(async () => ({ success: true, usage: { input_tokens: 3, output_tokens: 4 } }), options, context);
assert.deepEqual(entries[5].tokens, { input_tokens: 3, output_tokens: 4 });

const originalFetch = globalThis.fetch;
try {
  const { handleTtsCore } = await import("../open-sse/handlers/ttsCore.js");
  const { handleSttCore } = await import("../open-sse/handlers/sttCore.js");
  const usageMetadata = { promptTokenCount: 11, candidatesTokenCount: 23 };
  globalThis.fetch = async () => Response.json({ usageMetadata, candidates: [{ content: { parts: [{ inlineData: { data: "AAAAAA==" } }] } }] });
  const tts = await runSpeechInference(handleTtsCore, { ...options, provider: "gemini", model: "Kore", responseFormat: "json" }, context);
  assert.equal(tts.success, true);
  assert.equal(entries[6].tokens.prompt_tokens, 11);
  assert.equal(entries[6].tokens.completion_tokens, 23);
  assert.ok((await tts.response.json()).audio);
  globalThis.fetch = async () => Response.json({ usageMetadata, candidates: [{ content: { parts: [{ text: "hello" }] } }] });
  const formData = new FormData();
  formData.set("file", new Blob(["audio"], { type: "audio/wav" }), "audio.wav");
  const stt = await runSpeechInference(handleSttCore, { ...options, formData, sttConfig: { format: "gemini-stt", baseUrl: "https://example.invalid", authType: "apikey" } }, { ...context, endpoint: "/v1/audio/transcriptions" });
  assert.deepEqual(await stt.response.json(), { text: "hello" });
  assert.equal(entries[7].tokens.prompt_tokens, 11);
  assert.equal(entries[7].tokens.completion_tokens, 23);
  globalThis.fetch = async () => Response.json({ error: { message: "upstream failed" } }, { status: 503 });
  const failed = await runSpeechInference(handleSttCore, { ...options, formData, sttConfig: { format: "gemini-stt", baseUrl: "https://example.invalid", authType: "apikey" } }, context);
  assert.equal(failed.success, false);
  assert.equal(entries[8].status, "error");
  assert.deepEqual(entries[8].tokens, {});
} finally {
  globalThis.fetch = originalFetch;
}
console.log("Speech usage checks passed");
