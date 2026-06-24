#!/usr/bin/env node
import assert from "node:assert/strict";

import { synthOpenAIErrorChunk, synthResponsesFailure } from "../open-sse/utils/diagnostics.js";
import { convertResponsesStreamToJson } from "../open-sse/transformer/streamToJsonConverter.js";

function streamFromText(text) {
  return new Response(text, { headers: { "content-type": "text/event-stream" } }).body;
}

const chatError = synthOpenAIErrorChunk({ provider: "test", model: "model", reason: "empty_stream" });
assert.match(chatError, /^data: /);
assert.match(chatError, /"chat\.completion\.chunk"/);
assert.match(chatError, /"upstream_empty_response"/);

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

console.log("selfcheck-empty-stream: ok");
