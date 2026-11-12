import test from "node:test";
import assert from "node:assert/strict";
import { stripUnsupportedParams } from "../../open-sse/translator/concerns/paramSupport.js";
import nvidiaConfig from "../../open-sse/providers/registry/nvidia.js";
import { DefaultExecutor } from "../../open-sse/executors/default.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";

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
