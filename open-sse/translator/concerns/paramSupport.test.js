// Tests for paramSupport.js — strip + minimum enforcement for Sakana fugu
// and the other providers already wired into STRIP_RULES / MIN_RULES.
//
// Run from 9router/open-sse: `node --test translator/concerns/paramSupport.test.js`

import { test } from "node:test";
import assert from "node:assert/strict";
import { stripUnsupportedParams, enforceParamMinimums } from "./paramSupport.js";

// ---------- Sakana fugu / fugu-ultra ----------

test("fugu-ultra: bumps max_tokens from 1 up to floor 16", () => {
  const body = { model: "fugu-ultra", max_tokens: 1, messages: [] };
  enforceParamMinimums("openai-compatible-chat-x", "fugu-ultra", body);
  assert.equal(body.max_tokens, 16);
});

test("fugu-ultra: leaves max_tokens at 8000 alone (above floor)", () => {
  const body = { model: "fugu-ultra", max_tokens: 8000 };
  enforceParamMinimums("openai-compatible-chat-x", "fugu-ultra", body);
  assert.equal(body.max_tokens, 8000);
});

test("fugu-ultra dated alias (fugu-ultra-20260615): bumps max_tokens", () => {
  const body = { model: "fugu-ultra-20260615", max_tokens: 8 };
  enforceParamMinimums("openai-compatible-chat-x", "fugu-ultra-20260615", body);
  assert.equal(body.max_tokens, 16);
});

test("fugu: bumps max_completion_tokens below floor", () => {
  const body = { model: "fugu", max_completion_tokens: 4 };
  enforceParamMinimums("openai-compatible-chat-x", "fugu", body);
  assert.equal(body.max_completion_tokens, 16);
});

test("fugu-ultra: max_output_tokens bumped (Responses API field)", () => {
  const body = { model: "fugu-ultra", max_output_tokens: 2 };
  enforceParamMinimums("openai-compatible-chat-x", "fugu-ultra", body);
  assert.equal(body.max_output_tokens, 16);
});

test("fugu-ultra: leaves max_tokens undefined alone", () => {
  const body = { model: "fugu-ultra" };
  enforceParamMinimums("openai-compatible-chat-x", "fugu-ultra", body);
  assert.equal(body.max_tokens, undefined);
});

test("fugu-ultra: strips reasoning_effort=low (not in Sakana allow-list)", () => {
  const body = { model: "fugu-ultra", reasoning_effort: "low" };
  stripUnsupportedParams("openai-compatible-chat-x", "fugu-ultra", body);
  assert.equal(body.reasoning_effort, undefined);
});

test("fugu-ultra: keeps reasoning_effort=high (allowed)", () => {
  const body = { model: "fugu-ultra", reasoning_effort: "high" };
  stripUnsupportedParams("openai-compatible-chat-x", "fugu-ultra", body);
  assert.equal(body.reasoning_effort, "high");
});

test("fugu-ultra: keeps reasoning_effort=xhigh (allowed)", () => {
  const body = { model: "fugu-ultra", reasoning_effort: "xhigh" };
  stripUnsupportedParams("openai-compatible-chat-x", "fugu-ultra", body);
  assert.equal(body.reasoning_effort, "xhigh");
});

test("fugu-ultra: keeps reasoning_effort=max (alias of xhigh, allowed)", () => {
  const body = { model: "fugu-ultra", reasoning_effort: "max" };
  stripUnsupportedParams("openai-compatible-chat-x", "fugu-ultra", body);
  assert.equal(body.reasoning_effort, "max");
});

test("fugu: keeps reasoning_effort=minimal? no — drops it", () => {
  const body = { model: "fugu", reasoning_effort: "minimal" };
  stripUnsupportedParams("openai-compatible-chat-x", "fugu", body);
  assert.equal(body.reasoning_effort, undefined);
});

test("fugu-ultra: strips reasoning object when effort is not allowed", () => {
  const body = { model: "fugu-ultra", reasoning: { effort: "low" } };
  stripUnsupportedParams("openai-compatible-chat-x", "fugu-ultra", body);
  assert.equal(body.reasoning, undefined);
});

test("fugu-ultra: keeps reasoning object when effort=high", () => {
  const body = { model: "fugu-ultra", reasoning: { effort: "high" } };
  stripUnsupportedParams("openai-compatible-chat-x", "fugu-ultra", body);
  assert.deepEqual(body.reasoning, { effort: "high" });
});

test("fugu-ultra: strips previous_response_id (Responses API rejects)", () => {
  const body = { model: "fugu-ultra", previous_response_id: "resp_abc" };
  stripUnsupportedParams("openai-compatible-chat-x", "fugu-ultra", body);
  assert.equal(body.previous_response_id, undefined);
});

test("fugu-ultra: keeps temperature/top_p (accepted but ignored upstream)", () => {
  const body = { model: "fugu-ultra", temperature: 0.7, top_p: 0.9 };
  stripUnsupportedParams("openai-compatible-chat-x", "fugu-ultra", body);
  assert.equal(body.temperature, 0.7);
  assert.equal(body.top_p, 0.9);
});

test("fugu-ultra: integrated strip + min pipeline clamps and strips", () => {
  const body = {
    model: "fugu-ultra",
    max_tokens: 1,
    reasoning_effort: "low",
    previous_response_id: "resp_xyz",
    messages: [],
  };
  stripUnsupportedParams("openai-compatible-chat-x", "fugu-ultra", body);
  enforceParamMinimums("openai-compatible-chat-x", "fugu-ultra", body);
  assert.equal(body.max_tokens, 16);
  assert.equal(body.reasoning_effort, undefined);
  assert.equal(body.previous_response_id, undefined);
});

// ---------- existing rules should still pass ----------

test("claude-opus-4: temperature is stripped (existing rule #1748)", () => {
  const body = { model: "claude-opus-4-7", temperature: 0.5 };
  stripUnsupportedParams("anthropic", "claude-opus-4-7", body);
  assert.equal(body.temperature, undefined);
});

test("github copilot gpt-5.4: temperature stripped", () => {
  const body = { model: "gpt-5.4", temperature: 0.5 };
  stripUnsupportedParams("github", "gpt-5.4", body);
  assert.equal(body.temperature, undefined);
});

test("github copilot claude (non 4.6): reasoning_effort stripped", () => {
  const body = { model: "claude-sonnet-4.5", reasoning_effort: "high" };
  stripUnsupportedParams("github", "claude-sonnet-4.5", body);
  assert.equal(body.reasoning_effort, undefined);
});

test("github copilot claude opus 4.6: reasoning_effort kept", () => {
  const body = { model: "claude-opus-4.6", reasoning_effort: "high" };
  stripUnsupportedParams("github", "claude-opus-4.6", body);
  assert.equal(body.reasoning_effort, "high");
});

test("xai grok: reasoning_effort / reasoning / thinking stripped", () => {
  const body = { model: "grok-build-0.1", reasoning_effort: "high", reasoning: { x: 1 }, thinking: { y: 2 } };
  stripUnsupportedParams("xai", "grok-build-0.1", body);
  assert.equal(body.reasoning_effort, undefined);
  assert.equal(body.reasoning, undefined);
  assert.equal(body.thinking, undefined);
});

test("cloudflare-ai: content array flattens to string", () => {
  const body = {
    model: "@cf/meta/llama-3-8b-instruct",
    messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  };
  stripUnsupportedParams("cloudflare-ai", "@cf/meta/llama-3-8b-instruct", body);
  assert.equal(body.messages[0].content, "hi");
});

// ---------- guard rails ----------

test("non-matching model: no changes", () => {
  const body = { model: "gpt-5", max_tokens: 1, reasoning_effort: "low" };
  stripUnsupportedParams("openai", "gpt-5", body);
  enforceParamMinimums("openai", "gpt-5", body);
  assert.equal(body.max_tokens, 1);
  assert.equal(body.reasoning_effort, "low");
});

test("null model: returns body unchanged", () => {
  const body = { max_tokens: 1 };
  stripUnsupportedParams("openai-compatible-x", null, body);
  enforceParamMinimums("openai-compatible-x", null, body);
  assert.equal(body.max_tokens, 1);
});

test("non-object body: returns body unchanged", () => {
  stripUnsupportedParams("openai-compatible-x", "fugu-ultra", null);
  enforceParamMinimums("openai-compatible-x", "fugu-ultra", null);
  // Just ensure no throw.
  assert.ok(true);
});
