// Tests for openai-compatible API type runtime selection.
//
// Run from 9router/open-sse:
//   node --test services/provider.openaiCompatibleType.test.js

import { test } from "node:test";
import assert from "node:assert/strict";
import { getOpenAICompatibleType, getTargetFormat } from "./provider.js";

test("openai-compatible provider id defaults to chat when id contains chat", () => {
  assert.equal(getOpenAICompatibleType("openai-compatible-chat-abc"), "chat");
  assert.equal(getTargetFormat("openai-compatible-chat-abc"), "openai");
});

test("openai-compatible provider id defaults to responses when id contains responses", () => {
  assert.equal(getOpenAICompatibleType("openai-compatible-responses-abc"), "responses");
  assert.equal(getTargetFormat("openai-compatible-responses-abc"), "openai-responses");
});

test("providerSpecificData.apiType=responses overrides legacy chat id", () => {
  const credentials = { providerSpecificData: { apiType: "responses" } };
  assert.equal(getOpenAICompatibleType("openai-compatible-chat-abc", credentials), "responses");
  assert.equal(getTargetFormat("openai-compatible-chat-abc", credentials), "openai-responses");
});

test("providerSpecificData.apiType=chat overrides responses id", () => {
  const credentials = { providerSpecificData: { apiType: "chat" } };
  assert.equal(getOpenAICompatibleType("openai-compatible-responses-abc", credentials), "chat");
  assert.equal(getTargetFormat("openai-compatible-responses-abc", credentials), "openai");
});

test("invalid apiType is ignored and falls back to provider id", () => {
  const credentials = { providerSpecificData: { apiType: "completions" } };
  assert.equal(getOpenAICompatibleType("openai-compatible-responses-abc", credentials), "responses");
  assert.equal(getOpenAICompatibleType("openai-compatible-chat-abc", credentials), "chat");
});

test("non-openai-compatible provider still defaults to chat helper value", () => {
  assert.equal(getOpenAICompatibleType("openai"), "chat");
});
