#!/usr/bin/env node
import assert from "node:assert/strict";

import { readFile } from "node:fs/promises";

import { synthClaudeErrorEvents, synthOpenAIErrorChunk, synthResponsesFailure } from "../open-sse/utils/diagnostics.js";
import { convertResponsesStreamToJson } from "../open-sse/transformer/streamToJsonConverter.js";

function streamFromText(text) {
  return new Response(text, { headers: { "content-type": "text/event-stream" } }).body;
}

const chatError = synthOpenAIErrorChunk({ provider: "test", model: "model", reason: "empty_stream" });
assert.match(chatError, /^data: /);
assert.match(chatError, /"chat\.completion\.chunk"/);
assert.match(chatError, /"upstream_empty_response"/);

const claudeError = synthClaudeErrorEvents({ provider: "test", model: "model", reason: "empty_stream" });
assert.match(claudeError, /event: message_start/);
assert.match(claudeError, /event: content_block_delta/);
assert.match(claudeError, /event: message_stop/);
assert.doesNotMatch(claudeError, /^data: \{"object":"chat\.completion\.chunk"/m);

const responsesFailure = synthResponsesFailure("empty_stream");
assert.match(responsesFailure, /event: response\.failed/);
assert.match(responsesFailure, /stream closed before response\.completed/);

const emptyResponses = await convertResponsesStreamToJson(streamFromText("data: [DONE]\n\n"));
assert.equal(emptyResponses.status, "failed");
assert.equal(emptyResponses.empty, true);
assert.deepEqual(emptyResponses.output, []);

const okResponses = await convertResponsesStreamToJson(streamFromText([
  "event: response.output_item.done",
  "data: {\"output_index\":0,\"item\":{\"type\":\"message\",\"role\":\"assistant\",\"content\":[{\"type\":\"output_text\",\"text\":\"hi\"}]}}",
  "",
  "event: response.completed",
  "data: {\"response\":{\"usage\":{\"input_tokens\":1,\"output_tokens\":1,\"total_tokens\":2}}}",
  "",
].join("\n")));
assert.equal(okResponses.status, "completed");
assert.equal(okResponses.empty, false);
assert.equal(okResponses.output[0].content[0].text, "hi");

// Regression guards for the two empty-stream false-positives fixed in stream.js.
// Full behavioral import pulls the translator graph (needs 'undici'); assert the
// guards directly from source instead so this check stays self-contained.
const streamSrc = await readFile(new URL("../open-sse/utils/stream.js", import.meta.url), "utf8");

// Bug 1: passthrough must filter by the client-facing sourceFormat, not a hard-coded
// OpenAI shape (which dropped every Claude chunk and starved GLM clients).
assert.match(
  streamSrc,
  /hasValuableContent\(parsed, sourceFormat\)/,
  "passthrough must call hasValuableContent with sourceFormat (not hard-coded OPENAI)",
);
assert.doesNotMatch(
  streamSrc,
  /hasValuableContent\(parsed, FORMATS\.OPENAI\)/,
  "passthrough must not hard-code FORMATS.OPENAI in the valuable-content filter",
);

// Bug 2: producedOutput() must treat emitted valuable chunks as output, so translators
// whose parsed shape isn't accumulator-tracked (e.g. openai-responses → claude) do not
// raise a false MALFORMED-200 after a successful stream.
assert.match(
  streamSrc,
  /producedOutput = \(\) => totalContentLength > 0 \|\| sawToolCalls \|\| sawResponsesContent \|\| sseEmittedCount > 0/,
  "producedOutput() must include sseEmittedCount > 0",
);

// Bug 3: truly-empty streams must synthesize the client's stream format. Claude
// clients reject OpenAI chat chunks on /v1/messages as malformed HTTP 200 bodies.
assert.match(
  streamSrc,
  /sourceFormat === FORMATS\.CLAUDE\s*\? synthClaudeErrorEvents/,
  "empty-stream fallback must emit Claude-shaped events for Claude clients",
);

console.log("selfcheck-empty-stream: ok");
