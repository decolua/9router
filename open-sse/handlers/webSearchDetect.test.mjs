// Run: node --test open-sse/handlers/webSearchDetect.test.mjs
// Pure unit tests for the server-side web-search detection helpers.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectForcedWebSearch,
  extractSearchQuery,
  serverToolUseId,
  SERVER_TOOL_USE_ID,
} from "./webSearchDetect.js";

// The exact shape Claude Code's WebSearch side-query sends.
const ccForced = {
  model: "pw(stable-openai)/deepseek-v4.1-flash",
  max_tokens: 4096,
  stream: true,
  tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 8 }],
  tool_choice: { type: "tool", name: "web_search" },
  messages: [{ role: "user", content: "latest AI news" }],
};

test("fires on the Claude Code forced web_search side-query", () => {
  const hit = detectForcedWebSearch(ccForced);
  assert.ok(hit, "expected a hit");
  assert.equal(hit.query, "latest AI news");
  assert.equal(hit.maxResults, 8);
});

test("does NOT fire when web_search is merely one of many tools", () => {
  const body = {
    ...ccForced,
    tool_choice: { type: "auto" },
    tools: [
      { type: "web_search_20250305", name: "web_search" },
      { type: "custom", name: "Bash", input_schema: { type: "object" } },
    ],
  };
  assert.equal(detectForcedWebSearch(body), null, "auto-choice must pass through");
});

test("does NOT fire when a different tool is forced", () => {
  const body = { ...ccForced, tool_choice: { type: "tool", name: "Bash" } };
  assert.equal(detectForcedWebSearch(body), null);
});

test("does NOT fire when the forced name is a non-search tool reusing the type", () => {
  const body = {
    ...ccForced,
    tools: [{ type: "web_search_20250305", name: "something_else" }],
    tool_choice: { type: "tool", name: "something_else" },
  };
  assert.equal(detectForcedWebSearch(body), null);
});

test("ignores malformed bodies instead of throwing", () => {
  for (const bad of [null, undefined, 0, "x", {}, { tool_choice: {} }, { tool_choice: { type: "tool" } }]) {
    assert.equal(detectForcedWebSearch(bad), null);
  }
});

test("extracts the query from content blocks, not just strings", () => {
  const body = {
    ...ccForced,
    messages: [
      { role: "user", content: "old context" },
      { role: "assistant", content: "older answer" },
      { role: "user", content: [{ type: "text", text: "  what is the capital of Peru  " }] },
    ],
  };
  assert.equal(extractSearchQuery(body), "what is the capital of Peru");
});

test("extracts the LAST user text, not the first", () => {
  const body = {
    messages: [
      { role: "user", content: "first" },
      { role: "user", content: "second" },
    ],
  };
  assert.equal(extractSearchQuery(body), "second");
});

test("does not treat a tool_result-only final user turn as a query", () => {
  const body = {
    messages: [
      { role: "user", content: "real query" },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "irrelevant" }] },
    ],
  };
  assert.equal(extractSearchQuery(body), "real query");
});

test("no query means no interception", () => {
  const body = { ...ccForced, messages: [] };
  assert.equal(detectForcedWebSearch(body), null);
});

test("defaults max results when max_uses is absent or bogus", () => {
  const bare = { ...ccForced, tools: [{ type: "web_search_20250305", name: "web_search" }] };
  assert.equal(detectForcedWebSearch(bare).maxResults, 5);
  const bogus = { ...ccForced, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: "lots" }] };
  assert.equal(detectForcedWebSearch(bogus).maxResults, 5);
});

test("clamps max_uses to the hard ceiling", () => {
  const greedy = { ...ccForced, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5000 }] };
  assert.equal(detectForcedWebSearch(greedy).maxResults, 20);
});

test("tolerates a missing tool declaration and the custom type", () => {
  assert.ok(detectForcedWebSearch({ ...ccForced, tools: undefined }));
  assert.ok(detectForcedWebSearch({ ...ccForced, tools: [{ type: "custom", name: "web_search" }] }));
});

test("generated ids satisfy Anthropic's server_tool_use pattern", () => {
  for (let i = 0; i < 200; i++) {
    const id = serverToolUseId();
    assert.match(id, SERVER_TOOL_USE_ID, `bad id: ${id}`);
  }
  assert.match(serverToolUseId(), /^srvtoolu_/);
});
