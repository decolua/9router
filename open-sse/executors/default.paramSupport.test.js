// Integration tests: paramSupport wires into DefaultExecutor.transformRequest
//
// Asserts that the strip + enforce-minimum pipeline runs on the real executor
// path (not just when calling paramSupport helpers directly). Without this
// wiring, MIN_RULES are dead code at runtime.
//
// Run from 9router/open-sse: `node --test executors/default.paramSupport.test.js`

import { test } from "node:test";
import assert from "node:assert/strict";
import { DefaultExecutor } from "./default.js";

test("DefaultExecutor clamps max_tokens for Sakana fugu-ultra below the floor", () => {
  const executor = new DefaultExecutor("openai-compatible-chat-fugu");
  const body = {
    model: "fugu-ultra",
    max_tokens: 1,
    messages: [{ role: "user", content: "hi" }],
  };
  const out = executor.transformRequest("fugu-ultra", body);
  assert.equal(out.max_tokens, 16);
});

test("DefaultExecutor leaves max_tokens alone for non-fugu models", () => {
  const executor = new DefaultExecutor("openai-compatible-chat-x");
  const body = {
    model: "gpt-5",
    max_tokens: 1,
    messages: [{ role: "user", content: "hi" }],
  };
  const out = executor.transformRequest("gpt-5", body);
  assert.equal(out.max_tokens, 1);
});

test("DefaultExecutor strips xai grok reasoning_effort end-to-end", () => {
  const executor = new DefaultExecutor("xai");
  const body = {
    model: "grok-build-0.1",
    reasoning_effort: "high",
    messages: [{ role: "user", content: "hi" }],
  };
  const out = executor.transformRequest("grok-build-0.1", body);
  assert.equal(out.reasoning_effort, undefined);
});

test("DefaultExecutor strips fugu reasoning_effort=low (Sakana allow-list)", () => {
  const executor = new DefaultExecutor("openai-compatible-chat-fugu");
  const body = {
    model: "fugu-ultra",
    reasoning_effort: "low",
    messages: [{ role: "user", content: "hi" }],
  };
  const out = executor.transformRequest("fugu-ultra", body);
  assert.equal(out.reasoning_effort, undefined);
});
