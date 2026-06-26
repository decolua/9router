// Integration test: apiType override is threaded through getTargetFormat when
// called with credentials (the path chatCore.js:51 uses to decide whether to
// fire the OpenAI Responses → client body conversion in translateNonStreamingResponse).
//
// Without credentials in scope, a node whose id says "chat" but whose
// providerSpecificData.apiType="responses" would still return "openai"
// and the response translation would never run. This test pins the fix.

import { test } from "node:test";
import assert from "node:assert/strict";
import { getTargetFormat, getOpenAICompatibleType } from "./provider.js";

test("getTargetFormat(provider, credentials) honours apiType=responses override", () => {
  const credentials = { providerSpecificData: { apiType: "responses" } };
  // Node id says chat (no "responses" substring) but apiType override forces responses.
  const target = getTargetFormat("openai-compatible-chat-abc", credentials);
  assert.equal(target, "openai-responses");
});

test("getTargetFormat(provider, credentials) honours apiType=chat override", () => {
  const credentials = { providerSpecificData: { apiType: "chat" } };
  // Node id says responses (substring present) but apiType override forces chat.
  const target = getTargetFormat("openai-compatible-responses-abc", credentials);
  assert.equal(target, "openai");
});

test("getTargetFormat(provider) without credentials falls back to id-based detection", () => {
  // No credentials → id-based detection (legacy path). The override only
  // fires when credentials are explicitly threaded.
  assert.equal(getTargetFormat("openai-compatible-chat-abc"), "openai");
  assert.equal(getTargetFormat("openai-compatible-responses-abc"), "openai-responses");
});

test("getTargetFormat(provider, null credentials) is the same as 1-arg form", () => {
  // Explicit null credentials must not throw or alter behavior vs. 1-arg.
  assert.equal(
    getTargetFormat("openai-compatible-chat-abc", null),
    getTargetFormat("openai-compatible-chat-abc")
  );
});

test("getOpenAICompatibleType(provider, credentials) returns the override", () => {
  assert.equal(
    getOpenAICompatibleType("openai-compatible-chat-abc", { providerSpecificData: { apiType: "responses" } }),
    "responses"
  );
  assert.equal(
    getOpenAICompatibleType("openai-compatible-responses-abc", { providerSpecificData: { apiType: "chat" } }),
    "chat"
  );
});
