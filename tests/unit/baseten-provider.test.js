import { describe, expect, it } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { PROVIDERS, PROVIDER_MODELS } from "../../open-sse/providers/index.js";
import { applyThinking } from "../../open-sse/translator/concerns/thinkingUnified.js";
import { getThinkingLevels } from "../../open-sse/providers/thinkingLevels.js";
import { getCapabilitiesForModel } from "../../open-sse/providers/capabilities.js";
import { injectReasoningContent } from "../../open-sse/utils/reasoningContentInjector.js";
import { FORMATS } from "../../open-sse/translator/formats.js";

// Baseten Model APIs — OpenAI-compatible surface at inference.baseten.co/v1
// (docs.baseten.co/inference/model-apis). Slugs are org-prefixed. Reasoning:
// default-on models read top-level reasoning_effort; opt-in models
// (thinkingOptIn) additionally need chat_template_args.enable_thinking.
// Wire behavior verified against the live surface (GLM 5.2 / Nemotron probes).
const BT = "baseten";
const GLM_53 = "zai-org/GLM-5.3";
const GLM_52 = "zai-org/GLM-5.2";
const NEMOTRON = "nvidia/NVIDIA-Nemotron-3-Ultra-550B-A55B";
const DSV4_PRO = "deepseek-ai/DeepSeek-V4-Pro";

describe("Baseten provider registry", () => {
  const entry = REGISTRY.find((e) => e.id === BT);

  it("is registered as an OpenAI-compatible apikey provider", () => {
    expect(entry).toBeDefined();
    expect(entry.category).toBe("apikey");
    expect(PROVIDERS[BT]).toBeDefined();
    expect(PROVIDERS[BT].format).toBe("openai");
    expect(PROVIDERS[BT].thinkingFormat).toBe("baseten");
  });

  it("targets the Model APIs inference endpoint", () => {
    expect(PROVIDERS[BT].baseUrl).toBe("https://inference.baseten.co/v1/chat/completions");
    expect(PROVIDERS[BT].validateUrl).toBe("https://inference.baseten.co/v1/models");
  });

  it("exposes the documented slugs (latest catalog via modelsFetcher + passthroughModels)", () => {
    const ids = (PROVIDER_MODELS[BT] || []).map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining([
      "zai-org/GLM-5.3",
      "zai-org/GLM-5.2",
      "zai-org/GLM-4.7",
      "deepseek-ai/DeepSeek-V4-Pro",
      "deepseek-ai/DeepSeek-V4-Flash-0731",
      "moonshotai/Kimi-K3",
      "moonshotai/Kimi-K2.7-Code",
      "openai/gpt-oss-120b",
      NEMOTRON,
      "thinkingmachines/inkling",
    ]));
    expect(entry.passthroughModels).toBe(true);
    expect(entry.modelsFetcher?.url).toBe("https://inference.baseten.co/v1/models");
  });

  it("keeps every registry id unique after adding the provider", () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('Baseten thinking (case "baseten")', () => {
  it("default-on models: level → top-level reasoning_effort, no chat_template_args", () => {
    const out = applyThinking(FORMATS.OPENAI, GLM_53, { reasoning_effort: "high" }, BT);
    expect(out.reasoning_effort).toBe("high");
    expect(out.chat_template_args).toBeUndefined();
  });

  it('default-on models: none → reasoning_effort "none" (no enable_thinking flag)', () => {
    const out = applyThinking(FORMATS.OPENAI, GLM_53, { reasoning_effort: "none" }, BT);
    expect(out.reasoning_effort).toBe("none");
    expect(out.chat_template_args).toBeUndefined();
  });

  it("opt-in models: level → chat_template_args.enable_thinking:true + reasoning_effort", () => {
    const out = applyThinking(FORMATS.OPENAI, GLM_52, { reasoning_effort: "high" }, BT);
    expect(out.chat_template_args).toEqual({ enable_thinking: true });
    expect(out.reasoning_effort).toBe("high");
  });

  it("opt-in models: none → reasoning_effort \"none\" without the flag (GLM 5.2 rejects enable_thinking:false)", () => {
    const out = applyThinking(FORMATS.OPENAI, GLM_52, { reasoning_effort: "none" }, BT);
    expect(out.reasoning_effort).toBe("none");
    expect(out.chat_template_args).toBeUndefined();
  });

  it("opt-in flag-only models (Nemotron Ultra) enable thinking via the flag; effort rides along ignored", () => {
    const out = applyThinking(FORMATS.OPENAI, NEMOTRON, { reasoning_effort: "high" }, BT);
    expect(out.chat_template_args).toEqual({ enable_thinking: true });
    expect(out.reasoning_effort).toBe("high");
  });

  it("auto → model-default effort: flag only for opt-in models, no effort field", () => {
    const out = applyThinking(FORMATS.OPENAI, GLM_52, { reasoning_effort: "auto" }, BT);
    expect(out.chat_template_args).toEqual({ enable_thinking: true });
    expect(out.reasoning_effort).toBeUndefined();
  });
});

describe("Baseten thinking level sets (PATTERN_THINKING)", () => {
  it("GLM 5.3 offers none|low|high|max (Baseten 400s outside the set)", () => {
    expect(getThinkingLevels(BT, GLM_53)).toEqual(["none", "low", "high", "max"]);
  });

  it("GLM 5.2 offers none|high|max", () => {
    expect(getThinkingLevels(BT, GLM_52)).toEqual(["none", "high", "max"]);
  });

  it("effort-blind opt-in models get on/off only", () => {
    expect(getThinkingLevels(BT, "moonshotai/Kimi-K2.6")).toEqual(["none", "high"]);
    expect(getThinkingLevels(BT, "zai-org/GLM-4.7")).toEqual(["none", "high"]);
    expect(getThinkingLevels(BT, NEMOTRON)).toEqual(["none", "high"]);
  });

  it("full-effort models keep the whole set", () => {
    expect(getThinkingLevels(BT, "thinkingmachines/inkling")).toEqual(
      ["none", "minimal", "low", "medium", "high", "xhigh", "max"],
    );
  });

  it("non-reasoning passthrough slugs report no levels", () => {
    expect(getThinkingLevels(BT, "acme/unknown-model")).toBeNull();
  });
});

describe("Baseten capabilities", () => {
  it("marks opt-in models with thinkingOptIn", () => {
    expect(getCapabilitiesForModel(BT, GLM_52).thinkingOptIn).toBe(true);
    expect(getCapabilitiesForModel(BT, "moonshotai/Kimi-K2.7-Code").thinkingOptIn).toBe(true);
    expect(getCapabilitiesForModel(BT, GLM_53).thinkingOptIn).toBe(false);
    expect(getCapabilitiesForModel(BT, DSV4_PRO).thinkingOptIn).toBe(false);
  });

  it("resolves namespaced slugs to per-model caps (GLM 5.2: 1M ctx, vision)", () => {
    const caps = getCapabilitiesForModel(BT, GLM_52);
    expect(caps.vision).toBe(true);
    expect(caps.reasoning).toBe(true);
    expect(caps.contextWindow).toBe(1048576);
    expect(caps.maxOutput).toBe(262144);
  });

  it("keeps text-only models text-only (DeepSeek V4 Pro)", () => {
    const caps = getCapabilitiesForModel(BT, DSV4_PRO);
    expect(caps.reasoning).toBe(true);
    expect(caps.vision).toBe(false);
  });
});

describe("Baseten reasoning_content echo (tool-call loops)", () => {
  it("deepseek slugs get the placeholder inject (model-rule match, verified live)", () => {
    const body = {
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
      ],
    };
    const out = injectReasoningContent({ provider: BT, model: DSV4_PRO, body });
    expect(out.messages[1].reasoning_content).toBe(" ");
  });
});
