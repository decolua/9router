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

test("preserves Responses reasoning as Claude thinking", () => {
  const out = openAIResponsesBodyToClaude({
    id: "resp_reasoning",
    model: "model-a",
    output: [
      { type: "reasoning", summary: [{ type: "summary_text", text: "thinking" }] },
      { type: "message", content: [{ type: "output_text", text: "answer" }] },
    ],
  });

  assert.deepEqual(out.content, [
    { type: "thinking", thinking: "thinking" },
    { type: "text", text: "answer" },
  ]);
});

test("preserves Responses failure as explicit Claude error text", () => {
  const out = openAIResponsesBodyToClaude({
    id: "resp_failed",
    model: "model-a",
    status: "failed",
    error: { message: "model unavailable" },
    usage: { input_tokens: 4, output_tokens: 0 },
  });

  assert.equal(out.stop_reason, "end_turn");
  assert.deepEqual(out.content, [{ type: "text", text: "[Error] model unavailable" }]);
  assert.deepEqual(out.usage, { input_tokens: 4, output_tokens: 0 });
});

test("maps incomplete Responses status to Claude max_tokens", () => {
  const out = openAIResponsesBodyToClaude({
    id: "resp_incomplete",
    model: "model-a",
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
  });

  assert.equal(out.stop_reason, "max_tokens");
  assert.deepEqual(out.content, [{ type: "text", text: "[Error] max_output_tokens" }]);
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

test("preserves Responses reasoning as OpenAI reasoning_content", () => {
  const out = openAIResponsesBodyToOpenAI({
    id: "resp_5",
    model: "model-a",
    output: [
      { type: "reasoning", summary: [{ type: "summary_text", text: "thinking" }] },
      { type: "message", content: [{ type: "output_text", text: "answer" }] },
    ],
  });

  assert.equal(out.choices[0].message.content, "answer");
  assert.equal(out.choices[0].message.reasoning_content, "thinking");
});

test("preserves Responses failure as explicit OpenAI error text", () => {
  const out = openAIResponsesBodyToOpenAI({
    id: "resp_6",
    model: "model-a",
    status: "failed",
    error: { message: "model unavailable" },
  });

  assert.equal(out.choices[0].message.content, "[Error] model unavailable");
  assert.equal(out.choices[0].finish_reason, "stop");
});

test("appends Responses terminal text after partial OpenAI content", () => {
  const out = openAIResponsesBodyToOpenAI({
    id: "resp_partial_failed",
    model: "model-a",
    status: "failed",
    error: { message: "model unavailable" },
    output: [{ type: "message", content: [{ type: "output_text", text: "partial" }] }],
  });

  assert.equal(out.choices[0].message.content, "partial\n[Error] model unavailable");
});

test("maps incomplete Responses status to OpenAI length finish_reason", () => {
  const out = openAIResponsesBodyToOpenAI({
    id: "resp_7",
    model: "model-a",
    status: "incomplete",
    incomplete_details: { reason: "max_output_tokens" },
  });

  assert.equal(out.choices[0].message.content, "[Error] max_output_tokens");
  assert.equal(out.choices[0].finish_reason, "length");
});
