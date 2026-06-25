// Tests for non-streaming OpenAI Responses API body conversion.
//
// Run from 9router/open-sse:
//   node --test translator/response/openai-responses-nonstream.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { openAIResponsesBodyToClaude, openAIResponsesBodyToOpenAI } from "./openai-responses-nonstream.js";

test("converts Responses body to Claude message with usage fallback when usage is missing", () => {
  const out = openAIResponsesBodyToClaude({
    id: "resp_1",
    model: "model-a",
    output: [{
      type: "message",
      content: [{ type: "output_text", text: "hello" }],
    }],
  });

  assert.equal(out.type, "message");
  assert.equal(out.role, "assistant");
  assert.deepEqual(out.content, [{ type: "text", text: "hello" }]);
  assert.deepEqual(out.usage, { input_tokens: 0, output_tokens: 0 });
});

test("converts Responses usage to Claude fresh input plus cache read", () => {
  const out = openAIResponsesBodyToClaude({
    id: "resp_2",
    model: "model-a",
    output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }],
    usage: {
      input_tokens: 105,
      output_tokens: 7,
      input_tokens_details: { cached_tokens: 100 },
    },
  });

  assert.deepEqual(out.usage, {
    input_tokens: 5,
    output_tokens: 7,
    cache_read_input_tokens: 100,
  });
});

test("converts Responses function call to Claude tool_use", () => {
  const out = openAIResponsesBodyToClaude({
    id: "resp_tool",
    model: "model-a",
    output: [{
      type: "function_call",
      call_id: "call_1",
      name: "Read",
      arguments: '{"file_path":"/tmp/a.txt"}',
    }],
    usage: { input_tokens: 1, output_tokens: 2 },
  });

  assert.equal(out.stop_reason, "tool_use");
  assert.deepEqual(out.content, [{
    type: "tool_use",
    id: "call_1",
    name: "Read",
    input: { file_path: "/tmp/a.txt" },
  }]);
  assert.deepEqual(out.usage, { input_tokens: 1, output_tokens: 2 });
});

test("converts Responses body to OpenAI chat shape with usage fallback", () => {
  const out = openAIResponsesBodyToOpenAI({
    id: "resp_3",
    created_at: 123,
    model: "model-a",
    output: [{ type: "message", content: [{ type: "output_text", text: "hello" }] }],
  });

  assert.equal(out.object, "chat.completion");
  assert.equal(out.created, 123);
  assert.equal(out.choices[0].message.content, "hello");
  assert.deepEqual(out.usage, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 });
});

test("converts Responses cached usage to OpenAI prompt_tokens_details", () => {
  const out = openAIResponsesBodyToOpenAI({
    id: "resp_4",
    model: "model-a",
    output: [{ type: "message", content: [{ type: "output_text", text: "ok" }] }],
    usage: {
      input_tokens: 105,
      output_tokens: 7,
      input_tokens_details: { cached_tokens: 100 },
    },
  });

  assert.deepEqual(out.usage, {
    prompt_tokens: 105,
    completion_tokens: 7,
    total_tokens: 112,
    prompt_tokens_details: { cached_tokens: 100 },
  });
});
