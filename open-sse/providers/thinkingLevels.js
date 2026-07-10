// Resolve valid thinking levels per model — drives UI level picker (suffix "model(level)").
// Reuses capabilities.js (thinkingFormat/canDisable) so this file only maps format→levels (DRY).
import { getCapabilitiesForModel } from "./capabilities.js";
import { matchPattern } from "./pricing.js";

// Shared level sets (deduped) — verified against provider docs + wire in thinkingUnified.applyFormat.
const L = {
  base: ["none", "low", "medium", "high"],                          // qwen, step, hunyuan, gemini-budget
  onOff: ["none", "thinking"],                                      // zai (binary), minimax (adaptive)
  openai: ["none", "minimal", "low", "medium", "high", "xhigh"],    // GPT-5.x / o-series (no "max")
  levelMax: ["none", "low", "medium", "high", "max"],               // claude-adaptive, kimi
  budgetX: ["none", "low", "medium", "high", "xhigh", "max"],       // claude-budget
  gemini: ["minimal", "low", "medium", "high"],                     // gemini-3 thinkingLevel (no disable)
  hiMax: ["none", "high", "max"],                                   // deepseek (low/med→high, xhigh→max)
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

// Model-name pattern overrides (glob, first match wins) — more precise than format default.
// Note: matchPattern is model-name only (not provider id). GPT-5.6 family ids do not
// contain "codex", so they need explicit patterns / provider override.
const CODEX_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"]; // Codex cannot disable thinking
const PATTERN_THINKING = [
  { pattern: "*codex*", levels: CODEX_EFFORT_LEVELS },
  // Trailing-star alone can be fragile with dotted ids; cover exact + hyphen families.
  { pattern: "gpt-5.6", levels: CODEX_EFFORT_LEVELS },
  { pattern: "gpt-5.6-*", levels: CODEX_EFFORT_LEVELS },
];

// Returns valid thinking levels for a model, or null when the model has no reasoning.
export function getThinkingLevels(provider, model) {
  const caps = getCapabilitiesForModel(provider, model);
  if (!caps.reasoning) return null;
  // Codex provider always uses Responses effort levels for GPT-5.x routing.
  if (provider === "codex" || provider === "cx") {
    return CODEX_EFFORT_LEVELS.slice();
  }
  const hit = PATTERN_THINKING.find((p) => matchPattern(p.pattern, model));
  let levels = hit?.levels || FORMAT_LEVELS[caps.thinkingFormat] || L.base;
  if (caps.thinkingCanDisable === false) levels = levels.filter((l) => l !== "none");
  return levels;
}
