import test from "node:test";
import assert from "node:assert/strict";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";
import nvidiaConfig from "../../open-sse/providers/registry/nvidia.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";

test("NVIDIA transport quirks declare dropClientMetadata and timeoutMs", () => {
  assert.equal(nvidiaConfig.transport.quirks?.dropClientMetadata, true);
  assert.equal(nvidiaConfig.transport.timeoutMs, 90000);
});

test("NVIDIA models list includes meta/llama-3.3-70b-instruct and active models", () => {
  const hasLlama = nvidiaConfig.models.some((m) => m.id === "meta/llama-3.3-70b-instruct");
  const hasLightning = nvidiaConfig.models.some((m) => m.id === "nvidia/nemotron-3.5-lightning-30b-a3b");
  const hasBolt = nvidiaConfig.models.some((m) => m.id === "nvidia/nemotron-3.5-bolt-e4b");
  const hasLaguna = nvidiaConfig.models.some((m) => m.id === "poolside/laguna-xs-2.1");

  assert.equal(hasLlama, true);
  assert.equal(hasLightning, true);
  assert.equal(hasBolt, true);
  assert.equal(hasLaguna, true);
});

test("stripUnsupportedParams strips client_metadata, prompt_cache_key, service_tier, and extra fields for nvidia", () => {
  const payload = {
    model: "meta/llama-3.3-70b-instruct",
    messages: [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi", reasoning: "thinking text" },
    ],
    client_metadata: { source: "claude-code" },
    prompt_cache_key: "cache-123",
    service_tier: "default",
    anthropic_beta: ["tools-2024"],
    thinking_budget: 1024,
    user_id: "user-456",
    custom_field: "test",
    temperature: 0.7,
  };

  stripUnsupportedParams("nvidia", "meta/llama-3.3-70b-instruct", payload);

  assert.equal(payload.client_metadata, undefined);
  assert.equal(payload.prompt_cache_key, undefined);
  assert.equal(payload.service_tier, undefined);
  assert.equal(payload.anthropic_beta, undefined);
  assert.equal(payload.thinking_budget, undefined);
  assert.equal(payload.user_id, undefined);
  assert.equal(payload.custom_field, undefined);
  assert.equal(payload.temperature, 0.7);

  // Checks reasoning field was renamed to reasoning_content
  assert.equal(payload.messages[1].reasoning, undefined);
  assert.equal(payload.messages[1].reasoning_content, "thinking text");
});

test("DefaultExecutor.transformRequest strips all unsupported params and non-streaming stream_options for nvidia", () => {
  const executor = new DefaultExecutor("nvidia");
  const body = {
    model: "meta/llama-3.3-70b-instruct",
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello", reasoning: "secret thought" },
    ],
    client_metadata: { source: "claude-code" },
    stream_options: { include_usage: true },
    prompt_cache_key: "cache-key-1",
    service_tier: "auto",
  };

  const transformed = executor.transformRequest("meta/llama-3.3-70b-instruct", body, false, {});

  assert.equal("client_metadata" in transformed, false);
  assert.equal("stream_options" in transformed, false);
  assert.equal("prompt_cache_key" in transformed, false);
  assert.equal("service_tier" in transformed, false);
  assert.equal("reasoning" in transformed.messages[1], false);
  assert.equal(transformed.messages[1].reasoning_content, "secret thought");
});

test("checkFallbackError triggers modelScoped cooldown on 400 degraded for nvidia", () => {
  const result = checkFallbackError(400, "DEGRADED function cannot be invoked", 0, "nvidia");
  assert.equal(result.shouldFallback, true);
  assert.equal(result.modelScoped, true);
  assert.equal(result.cooldownMs, 15 * 60 * 1000);
});

test("NVIDIA model capabilities distinguish tools support", () => {
  const llamaCaps = getCapabilitiesForModel("nvidia", "meta/llama-3.3-70b-instruct");
  const minimaxCaps = getCapabilitiesForModel("nvidia", "minimaxai/minimax-m3");

  assert.equal(llamaCaps.tools, true);
  assert.equal(minimaxCaps.tools, false);
});

// ── NIM strict envelopes (see build.nvidia.com/<model>/apireference) ───────

test("NVIDIA registry ships Kimi K3.1 Pro, Step 5 Preview and the new live chat models", () => {
  const ids = nvidiaConfig.models.map((m) => m.id);

  assert.ok(ids.includes("moonshotai/kimi-k3.1-pro"));
  assert.ok(ids.includes("stepfun-ai/step-5-preview"));
  assert.ok(ids.includes("minimaxai/minimax-m3.1-flash"));
  assert.ok(ids.includes("z-ai/glm-5.3-flash"));
  assert.ok(ids.includes("nvidia/nemotron-3.5-super-vl-120b-a12b"));
  assert.ok(ids.includes("mistralai/mistral-large-4-1t-a52b"));
});

test("NVIDIA exposes the live NIM catalogue so new models appear without a release", () => {
  assert.equal(nvidiaConfig.modelsFetcher?.url, "https://integrate.api.nvidia.com/v1/models");
  assert.equal(nvidiaConfig.modelsFetcher?.type, "nvidia");
});

test("Kimi K3.1 Pro on NIM keeps only the fields its schema declares", () => {
  const payload = {
    model: "moonshotai/kimi-k3.1-pro",
    messages: [{ role: "user", content: "hi" }],
    temperature: 0.7,
    top_p: 0.9,
    tool_choice: "auto",
    response_format: { type: "json_object" },
    seed: 42,
    stream: true,
    max_tokens: 200000,
  };

  stripUnsupportedParams("nvidia", "moonshotai/kimi-k3.1-pro", payload);

  assert.equal(payload.temperature, undefined);
  assert.equal(payload.top_p, undefined);
  assert.equal(payload.tool_choice, undefined);
  assert.equal(payload.response_format, undefined);
  assert.equal(payload.seed, 42);
  assert.equal(payload.stream, true);
  // Kimi K3.1 Pro's schema caps max_tokens at 65536.
  assert.equal(payload.max_tokens, 65536);
});

test("Kimi K3.1 Pro on NIM flattens system/assistant content but keeps user content parts", () => {
  const payload = {
    model: "moonshotai/kimi-k3.1-pro",
    messages: [
      { role: "system", content: [{ type: "text", text: "be brief" }] },
      { role: "user", content: [{ type: "text", text: "look" }, { type: "image_url", image_url: { url: "data:image/png;base64,x" } }] },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
    ],
  };

  stripUnsupportedParams("nvidia", "moonshotai/kimi-k3.1-pro", payload);

  assert.equal(payload.messages[0].content, "be brief");
  assert.equal(payload.messages[2].content, "ok");
  assert.ok(Array.isArray(payload.messages[1].content));
  assert.equal(payload.messages[1].content[1].type, "image_url");
});

test("Step 5 Preview on NIM drops the reasoning_effort field its schema does not declare", () => {
  const payload = {
    model: "stepfun-ai/step-5-preview",
    messages: [{ role: "user", content: "hi" }],
    reasoning_effort: "high",
    thinking: { type: "enabled" },
    temperature: 0.4,
  };

  stripUnsupportedParams("nvidia", "stepfun-ai/step-5-preview", payload);

  assert.equal(payload.reasoning_effort, undefined);
  assert.equal(payload.thinking, undefined);
  assert.equal(payload.temperature, 0.4);
});

test("an unknown NIM model falls back to the fields every NIM chat endpoint accepts", () => {
  const payload = {
    model: "somevendor/some-new-model",
    messages: [{ role: "user", content: "hi" }],
    temperature: 0.4,
    top_p: 1,
    response_format: { type: "json_object" },
    max_tokens: 100,
    stream: true,
  };

  stripUnsupportedParams("nvidia", "somevendor/some-new-model", payload);

  assert.equal(payload.temperature, undefined);
  assert.equal(payload.top_p, undefined);
  assert.equal(payload.response_format, undefined);
  assert.equal(payload.max_tokens, 100);
  assert.equal(payload.stream, true);
});

test("NIM thinking levels match each endpoint's reasoning_effort enum", () => {
  assert.deepEqual(getThinkingLevels("nvidia", "moonshotai/kimi-k3.1-pro"), ["low", "high", "max"]);
  assert.deepEqual(getThinkingLevels("nvidia", "nvidia/nemotron-3.5-super-vl-120b-a12b"), ["none", "low", "high"]);
  assert.deepEqual(getThinkingLevels("nvidia", "mistralai/mistral-large-4-1t-a52b"), ["none", "high"]);
});

test("a reasoning_effort outside Kimi K3.1 Pro's enum is rounded up, never dropped", () => {
  const body = { messages: [], reasoning_effort: "medium" };
  applyThinking("openai", "moonshotai/kimi-k3.1-pro", body, "nvidia");

  assert.equal(body.reasoning_effort, "high");
});

test("Kimi K3.1 Pro capabilities report a 1M context and the openai reasoning shape", () => {
  const caps = getCapabilitiesForModel("nvidia", "moonshotai/kimi-k3.1-pro");

  assert.equal(caps.vision, true);
  assert.equal(caps.tools, true);
  assert.equal(caps.reasoning, true);
  assert.equal(caps.thinkingFormat, "openai");
  assert.equal(caps.thinkingCanDisable, false);
  assert.equal(caps.contextWindow, 1048576);
  assert.equal(caps.maxOutput, 65536);
});

test("Step 5 Preview capabilities report always-on reasoning", () => {
  const caps = getCapabilitiesForModel("nvidia", "stepfun-ai/step-5-preview");

  assert.equal(caps.vision, true);
  assert.equal(caps.tools, true);
  assert.equal(caps.reasoning, true);
  assert.equal(caps.thinkingCanDisable, false);
  assert.equal(caps.contextWindow, 1048576);
});
