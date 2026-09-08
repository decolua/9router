// Resolve valid thinking levels per model — drives UI level picker (suffix "model(level)").
// Reuses capabilities.js (thinkingFormat/canDisable) so this file only maps format→levels (DRY).
import { getCapabilitiesForModel } from "./capabilities.js";
import { matchPattern } from "./pricing.js";
import { resolveKiroEffortPath } from "../config/kiroConstants.js";

// Shared level sets (deduped) — verified against provider docs + wire in thinkingUnified.applyFormat.
const L = {
  base: ["none", "low", "medium", "high"],                          // qwen, step, hunyuan, gemini-budget
  onOff: ["none", "thinking"],                                      // zai (binary), minimax (adaptive)
  openai: ["none", "minimal", "low", "medium", "high", "xhigh"],    // GPT-5.x / o-series (no "max")
  levelMax: ["none", "low", "medium", "high", "max"],               // claude-adaptive, kimi
  budgetX: ["none", "low", "medium", "high", "xhigh", "max"],       // claude-budget
  gemini: ["minimal", "low", "medium", "high"],                     // gemini-3 thinkingLevel (no disable)
  hiMax: ["none", "high", "max"],                                   // deepseek (low/med→high, xhigh→max)
  baseten: ["none", "minimal", "low", "medium", "high", "xhigh", "max"], // Baseten full effort set (per-model patterns narrow it)
};

// thinkingFormat → valid selectable levels (source of truth for UI options).
const FORMAT_LEVELS = {
  openai: L.openai,
  "claude-adaptive": L.levelMax,
  "claude-budget": L.budgetX,
  "gemini-level": L.gemini,
  "gemini-budget": L.base,
  zai: L.onOff,
  qwen: L.base,
  kimi: L.levelMax,
  deepseek: L.hiMax,
  minimax: L.onOff,
  hunyuan: L.base,
  step: L.base,
};

const CODEX_GPT_5_6_LEVELS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

// Model-name pattern overrides (glob, first match wins) — more precise than format default.
const PATTERN_THINKING = [
  { provider: "codex", pattern: "*gpt-6*", levels: CODEX_GPT_5_6_LEVELS },
  { provider: "codex", pattern: "*gpt-5.6-sol*", levels: [...CODEX_GPT_5_6_LEVELS, "ultra"] },
  { provider: "codex", pattern: "*gpt-5.6-terra*", levels: [...CODEX_GPT_5_6_LEVELS, "ultra"] },
  { provider: "codex", pattern: "*gpt-5.6-luna*", levels: CODEX_GPT_5_6_LEVELS },
  { pattern: "*codex*", levels: ["low", "medium", "high", "xhigh"] }, // codex cannot disable thinking
  // codebuddy-cn per-model effort sets — the server's product-config payload
  // publishes `reasoning.supportedEfforts` per model. NOTE: the chat endpoint
  // accepts any level you send (probed none/minimal/low/medium/high/xhigh/max
  // → all 200), but values outside a model's supportedEfforts are silently
  // clamped, so the declared set stays authoritative for the picker. Models
  // that publish no supportedEfforts (glm-5.1 / glm-5v-turbo / kimi-k2.x /
  // kimi-k3-1 / minimax-m3) fall through to the openai format default.
  { provider: "codebuddy-cn", pattern: "glm-5.3*",     levels: ["low", "high", "max"] },
  { provider: "codebuddy-cn", pattern: "glm-5.2",      levels: ["high", "xhigh"] },
  { provider: "codebuddy-cn", pattern: "deepseek-v4*", levels: ["low", "high", "xhigh"] },
  { provider: "codebuddy-cn", pattern: "hy3*",         levels: ["low", "high"] },
  { provider: "codebuddy-cn", pattern: "hy4*",         levels: ["high"] },
  // Baseten Model APIs — per-model reasoning_effort sets from the docs. Baseten
  // validates top-level values (400 outside the set), so the picker must offer
  // exactly the supported levels. Effort-blind opt-in models get on/off only
  // ("high" = thinking on; the effort value is accepted but ignored upstream).
  { provider: "baseten", pattern: "*DeepSeek-V4-Pro-0813*", levels: ["none", "low", "high", "max"] },
  { provider: "baseten", pattern: "*DeepSeek-V4-Pro*",      levels: ["none", "minimal", "low", "medium", "high", "xhigh", "max"] },
  { provider: "baseten", pattern: "*DeepSeek-V4-Flash*",    levels: ["none", "minimal", "low", "medium", "high", "xhigh", "max"] },
  { provider: "baseten", pattern: "*GLM-5.2*",     levels: ["none", "high", "max"] },
  { provider: "baseten", pattern: "*GLM-5.3*",     levels: ["none", "low", "high", "max"] },
  { provider: "baseten", pattern: "*GLM-4.7*",     levels: ["none", "high"] },
  { provider: "baseten", pattern: "*Kimi-K3*",     levels: ["none", "low", "high", "max"] },
  { provider: "baseten", pattern: "*Kimi-K2*",     levels: ["none", "high"] },
  { provider: "baseten", pattern: "*Nemotron*",    levels: ["none", "high"] },
  { provider: "baseten", pattern: "*Inkling*",     levels: ["none", "minimal", "low", "medium", "high", "xhigh", "max"] },
  { provider: "baseten", pattern: "*gpt-oss-120b*", levels: ["none", "minimal", "low", "medium", "high", "xhigh", "max"] },
];

// Returns valid thinking levels for a model, or null when the model has no reasoning.
export function getThinkingLevels(provider, model) {
  if (provider === "kiro" && resolveKiroEffortPath(model) === null) return null;
  const caps = getCapabilitiesForModel(provider, model);
  if (!caps.reasoning) return null;
  const hit = PATTERN_THINKING.find((entry) =>
    (!entry.provider || entry.provider === provider) && matchPattern(entry.pattern, model)
  );
  let levels = hit?.levels || FORMAT_LEVELS[caps.thinkingFormat] || L.base;
  if (caps.thinkingCanDisable === false) levels = levels.filter((l) => l !== "none");
  return levels;
}
