/**
 * Unit tests for the Xiaomi MiMo Token Plan executor URL routing.
 *
 * The Token Plan provider serves two endpoint shapes from one base URL:
 *   - OpenAI-compatible models  → {base}/chat/completions
 *   - Claude-native aliases     → {base}/anthropic/v1/messages
 *
 * The Claude-native alias (mimo-v2.5-pro-claude) carries targetFormat: "claude"
 * in the provider catalog, so its request body is translated to Anthropic shape.
 * buildUrl MUST therefore route it to the /anthropic/v1/messages endpoint —
 * otherwise a Claude-shaped body (tools as {name, input_schema}) is POSTed to the
 * OpenAI /chat/completions endpoint, which rejects it with:
 *   [400] Param Incorrect: `function` is not set
 *
 * getModelTargetFormat(aliasOrId, modelId) keys its lookup table by PROVIDER
 * (alias/id), not by model id. Passing the model id as the first argument makes
 * it return null, silently downgrading the Claude route to the OpenAI one.
 */

import { describe, it, expect } from "vitest";

import { XiaomiTokenplanExecutor } from "../../open-sse/executors/xiaomi-tokenplan.js";
import { getModelTargetFormat, PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

const CREDS = { providerSpecificData: { region: "sgp" } };
const BASE = "https://token-plan-sgp.xiaomimimo.com/v1";

describe("xiaomi-tokenplan provider catalog", () => {
  it("registers the Claude-native MiMo alias with targetFormat claude", () => {
    const entry = PROVIDER_MODELS["xiaomi-tokenplan"].find(m => m.id === "mimo-v2.5-pro-claude");
    expect(entry).toBeDefined();
    expect(entry.targetFormat).toBe("claude");
    expect(entry.upstreamModelId).toBe("mimo-v2.5-pro");
  });

  it("keys getModelTargetFormat by provider id, not model id", () => {
    // Provider-keyed lookup resolves the Claude format...
    expect(getModelTargetFormat("xiaomi-tokenplan", "mimo-v2.5-pro-claude")).toBe(FORMATS.CLAUDE);
    // ...while a model-keyed lookup (the bug) returns null.
    expect(getModelTargetFormat("mimo-v2.5-pro-claude", "mimo-v2.5-pro-claude")).toBeNull();
  });
});

describe("XiaomiTokenplanExecutor.buildUrl", () => {
  const executor = new XiaomiTokenplanExecutor();

  it("routes the Claude-native alias to the Anthropic messages endpoint", () => {
    const url = executor.buildUrl("mimo-v2.5-pro-claude", true, 0, CREDS);
    expect(url).toBe("https://token-plan-sgp.xiaomimimo.com/anthropic/v1/messages");
  });

  it("routes OpenAI-format models to the chat/completions endpoint", () => {
    const url = executor.buildUrl("mimo-v2.5-pro", true, 0, CREDS);
    expect(url).toBe(`${BASE}/chat/completions`);
  });

  it("targets the xiaomi-tokenplan provider", () => {
    expect(executor.getProvider()).toBe("xiaomi-tokenplan");
  });
});
