/**
 * Unit tests for the 9Router -> Oh My Pi models.yml capability mapper.
 *
 * Schema reference (installed package, omp 17.3.7):
 *   @oh-my-pi/pi-coding-agent/dist/types/config/models-config-schema.d.ts
 *   @oh-my-pi/pi-coding-agent/dist/types/config/model-roles.d.ts
 *
 * These lock the contract that the dashboard and the omp-settings route both
 * depend on: context window / max output actually survive into models.yml, and
 * gateway thinking formats collapse onto values models.yml legally accepts.
 */
import { describe, it, expect } from "vitest";
import {
  buildOmpModelEntry,
  toOmpCapabilityPayload,
  translateThinking,
  formatContextWindow,
  OMP_THINKING_MODES,
} from "@/shared/constants/ompModelSchema.js";
import { OMP_ROLE_IDS, OMP_MODEL_ROLES } from "@/shared/constants/ompRoles.js";

// compat.thinkingFormat union from models-config-schema.d.ts
const LEGAL_FORMATS = new Set(["openai", "openrouter", "qwen", "qwen-chat-template", "zai"]);

// ModelRole union from model-roles.d.ts (omp 17.3.7)
const OMP_CANONICAL_ROLES = [
  "default", "smol", "slow", "vision", "plan",
  "designer", "commit", "tiny", "task", "advisor",
];

describe("OMP role coverage", () => {
  it("exposes every canonical omp ModelRole, in order", () => {
    expect(OMP_ROLE_IDS).toEqual(OMP_CANONICAL_ROLES);
  });

  it("gives every role a display name and hint for the picker", () => {
    expect(OMP_MODEL_ROLES).toHaveLength(OMP_CANONICAL_ROLES.length);
    for (const role of OMP_MODEL_ROLES) {
      expect(role.name?.length).toBeGreaterThan(0);
      expect(role.hint?.length).toBeGreaterThan(0);
    }
  });
});

describe("translateThinking", () => {
  it("maps claude adaptive/budget onto omp anthropic modes", () => {
    expect(translateThinking("claude-adaptive")).toEqual({
      mode: OMP_THINKING_MODES.ANTHROPIC_ADAPTIVE,
      format: "openai",
    });
    expect(translateThinking("claude-budget")).toEqual({
      mode: OMP_THINKING_MODES.ANTHROPIC_BUDGET_EFFORT,
      format: "openai",
    });
  });

  it("maps both gemini formats onto google-level", () => {
    expect(translateThinking("gemini-level").mode).toBe(OMP_THINKING_MODES.GOOGLE_LEVEL);
    expect(translateThinking("gemini-budget").mode).toBe(OMP_THINKING_MODES.GOOGLE_LEVEL);
  });

  it("keeps zai/qwen wire formats, which models.yml accepts natively", () => {
    expect(translateThinking("zai")).toEqual({ mode: OMP_THINKING_MODES.EFFORT, format: "zai" });
    expect(translateThinking("qwen")).toEqual({ mode: OMP_THINKING_MODES.EFFORT, format: "qwen" });
  });

  it("collapses vendor formats models.yml cannot express onto openai", () => {
    for (const fmt of ["kimi", "minimax", "deepseek", "hunyuan", "step"]) {
      expect(translateThinking(fmt)).toEqual({ mode: OMP_THINKING_MODES.EFFORT, format: "openai" });
    }
  });

  it("never emits a format outside the models.yml union", () => {
    const inputs = [
      "claude-adaptive", "claude-budget", "gemini-level", "gemini-budget",
      "zai", "qwen", "openai", "kimi", "minimax", "deepseek", "hunyuan", "step",
      "totally-unknown", null, undefined, "",
    ];
    for (const fmt of inputs) {
      expect(LEGAL_FORMATS.has(translateThinking(fmt).format)).toBe(true);
    }
  });
});

describe("buildOmpModelEntry", () => {
  it("carries context window and max output into the entry", () => {
    const entry = buildOmpModelEntry("cc/claude-opus-5", {
      vision: true,
      reasoning: true,
      contextWindow: 1000000,
      maxOutput: 128000,
      thinkingFormat: "claude-adaptive",
    });
    expect(entry.contextWindow).toBe(1000000);
    expect(entry.maxTokens).toBe(128000);
    expect(entry.input).toEqual(["text", "image"]);
    expect(entry.reasoning).toBe(true);
    expect(entry.thinking).toEqual({
      mode: OMP_THINKING_MODES.ANTHROPIC_ADAPTIVE,
      efforts: ["low", "medium", "high", "max"],
    });
    expect(entry.compat.thinkingFormat).toBe("openai");
    expect(entry.compat.supportsReasoningEffort).toBe(true);
  });

  it("omits limits the gateway did not report rather than inventing them", () => {
    const entry = buildOmpModelEntry("some/model", { reasoning: false });
    expect(entry).not.toHaveProperty("contextWindow");
    expect(entry).not.toHaveProperty("maxTokens");
    expect(entry).not.toHaveProperty("thinking");
    expect(entry.compat).not.toHaveProperty("supportsReasoningEffort");
  });

  it("survives a completely absent capability object", () => {
    const entry = buildOmpModelEntry("bare/model", undefined);
    expect(entry.id).toBe("bare/model");
    expect(entry.name).toBe("bare/model");
    expect(entry.input).toEqual(["text"]);
    expect(entry.supportsTools).toBe(true);
    expect(entry.compat.thinkingFormat).toBe("openai");
  });

  it("marks text-only models without an image input", () => {
    const entry = buildOmpModelEntry("text/only", { vision: false, contextWindow: 128000 });
    expect(entry.input).toEqual(["text"]);
    expect(entry.contextWindow).toBe(128000);
  });

  it("only disables tools when the gateway explicitly says so", () => {
    expect(buildOmpModelEntry("img/gen", { tools: false }).supportsTools).toBe(false);
    expect(buildOmpModelEntry("normal", { tools: true }).supportsTools).toBe(true);
    expect(buildOmpModelEntry("unset", {}).supportsTools).toBe(true);
  });

  it("rejects non-positive and non-finite limits", () => {
    const entry = buildOmpModelEntry("weird/model", {
      contextWindow: 0,
      maxOutput: -1,
    });
    expect(entry).not.toHaveProperty("contextWindow");
    expect(entry).not.toHaveProperty("maxTokens");

    const nan = buildOmpModelEntry("nan/model", {
      contextWindow: Number.NaN,
      maxOutput: Number.POSITIVE_INFINITY,
    });
    expect(nan).not.toHaveProperty("contextWindow");
    expect(nan).not.toHaveProperty("maxTokens");
  });

  it("uses the google effort ladder for gemini models", () => {
    const entry = buildOmpModelEntry("gc/gemini-3-pro-preview", {
      vision: true,
      reasoning: true,
      thinkingFormat: "gemini-level",
      contextWindow: 1048576,
      maxOutput: 65535,
    });
    expect(entry.thinking).toEqual({
      mode: OMP_THINKING_MODES.GOOGLE_LEVEL,
      efforts: ["minimal", "low", "medium", "high"],
    });
    expect(entry.contextWindow).toBe(1048576);
  });

  it("uses the full effort ladder for openai-style reasoning models", () => {
    const entry = buildOmpModelEntry("cx/gpt-5.6-sol", {
      vision: true,
      reasoning: true,
      thinkingFormat: "openai",
      contextWindow: 372000,
      maxOutput: 128000,
    });
    expect(entry.thinking.mode).toBe(OMP_THINKING_MODES.EFFORT);
    expect(entry.thinking.efforts).toEqual(["minimal", "low", "medium", "high", "xhigh", "max"]);
  });

  it("floors fractional limits to integers", () => {
    const entry = buildOmpModelEntry("frac/model", { contextWindow: 200000.7, maxOutput: 64000.9 });
    expect(entry.contextWindow).toBe(200000);
    expect(entry.maxTokens).toBe(64000);
  });
});

describe("toOmpCapabilityPayload", () => {
  it("forwards the limits the old payload silently dropped", () => {
    const payload = toOmpCapabilityPayload({
      vision: true,
      search: true,
      reasoning: true,
      tools: true,
      contextWindow: 1048576,
      maxOutput: 131072,
      thinkingFormat: "kimi",
    });
    expect(payload).toEqual({
      vision: true,
      search: true,
      reasoning: true,
      tools: true,
      contextWindow: 1048576,
      maxOutput: 131072,
      thinkingFormat: "kimi",
    });
  });

  it("returns null when there are no capabilities to send", () => {
    expect(toOmpCapabilityPayload(null)).toBeNull();
    expect(toOmpCapabilityPayload(undefined)).toBeNull();
  });

  it("round-trips through buildOmpModelEntry without losing limits", () => {
    const gatewayCaps = {
      vision: true,
      reasoning: true,
      contextWindow: 1048576,
      maxOutput: 131072,
      thinkingFormat: "kimi",
    };
    const entry = buildOmpModelEntry("kimi/k3", toOmpCapabilityPayload(gatewayCaps));
    expect(entry.contextWindow).toBe(1048576);
    expect(entry.maxTokens).toBe(131072);
    expect(entry.input).toEqual(["text", "image"]);
    expect(entry.compat.thinkingFormat).toBe("openai");
  });
});

describe("formatContextWindow", () => {
  it("renders millions and thousands compactly", () => {
    expect(formatContextWindow(1000000)).toBe("1M");
    expect(formatContextWindow(1048576)).toBe("1.0M");
    expect(formatContextWindow(2000000)).toBe("2M");
    expect(formatContextWindow(200000)).toBe("200K");
    expect(formatContextWindow(128000)).toBe("128K");
    expect(formatContextWindow(900)).toBe("900");
  });

  it("returns null for missing or invalid values", () => {
    expect(formatContextWindow(0)).toBeNull();
    expect(formatContextWindow(-5)).toBeNull();
    expect(formatContextWindow(undefined)).toBeNull();
    expect(formatContextWindow(Number.NaN)).toBeNull();
  });
});
