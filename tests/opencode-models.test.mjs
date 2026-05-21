import test from "node:test";
import assert from "node:assert/strict";

import { getProviderModels, getModelTargetFormat } from "../open-sse/config/providerModels.js";
import { OpenCodeExecutor } from "../open-sse/executors/opencode.js";

const executor = new OpenCodeExecutor();

test("opencode catalog exposes zen models", () => {
  const models = getProviderModels("oc");
  assert.ok(models.length > 0, "expected OpenCode models to be registered");
  assert.ok(models.some((m) => m.id === "gpt-5.5"));
  assert.ok(models.some((m) => m.id === "claude-opus-4-7"));
  assert.ok(models.some((m) => m.id === "gemini-3-flash"));
});

test("opencode route selection follows zen model family", () => {
  assert.equal(executor.buildUrl("gpt-5.5"), "https://opencode.ai/zen/v1/responses");
  assert.equal(executor.buildUrl("claude-opus-4-7"), "https://opencode.ai/zen/v1/messages");
  assert.equal(executor.buildUrl("gemini-3-flash"), "https://opencode.ai/zen/v1/models/gemini-3-flash");
  assert.equal(executor.buildUrl("qwen3.6-plus"), "https://opencode.ai/zen/v1/chat/completions");
  assert.equal(executor.buildUrl("big-pickle"), "https://opencode.ai/zen/v1/chat/completions");
});

test("opencode model target formats are wired for translation", () => {
  assert.equal(getModelTargetFormat("oc", "gpt-5.5"), "openai-responses");
  assert.equal(getModelTargetFormat("oc", "claude-opus-4-7"), "claude");
  assert.equal(getModelTargetFormat("oc", "gemini-3-flash"), "gemini");
});
