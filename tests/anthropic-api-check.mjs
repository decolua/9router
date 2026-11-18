import assert from "node:assert/strict";
import { DefaultExecutor } from "../open-sse/executors/default.js";
import anthropic from "../open-sse/providers/registry/anthropic.js";

const executor = new DefaultExecutor("anthropic");
const headers = executor.buildHeaders({ apiKey: "test-key" }, false);
assert.equal(headers["anthropic-version"], "2026-10-21");
assert.equal(headers["x-api-key"], "test-key");
assert.equal(headers["Anthropic-Beta"], undefined);
const body = executor.transformRequest("claude-haiku-5-5", {
  messages: [{ role: "user", content: "hello" }], temperature: 0, top_p: 0.5, top_k: 10, max_tokens: 100,
}, false, { apiKey: "test-key" });
assert.equal(body.temperature, undefined);
assert.equal(body.top_p, undefined);
assert.equal(body.top_k, undefined);
assert.equal(body.max_tokens, 100);
assert(anthropic.models.some(({ id }) => id === "claude-fable-5-2"));
assert(anthropic.models.some(({ id }) => id === "claude-haiku-5-5"));
