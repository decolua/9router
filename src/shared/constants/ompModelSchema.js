// Map 9Router gateway capabilities onto the Oh My Pi models.yml model schema.
//
// Schema source (authoritative, read from the installed package):
//   @oh-my-pi/pi-coding-agent/dist/types/config/models-config-schema.d.ts
// Model fields we emit: id, name, input[], reasoning, supportsTools,
// contextWindow, maxTokens, thinking{mode,efforts}, compat{...}.
//
// 9Router's own capability vocabulary (open-sse/providers/capabilities.js) is
// richer than what models.yml accepts, so two translations are required:
//
//   1. thinkingFormat — the gateway emits claude-adaptive | claude-budget |
//      gemini-level | gemini-budget | kimi | minimax | deepseek | hunyuan |
//      step | openai | zai | qwen. models.yml's compat.thinkingFormat only
//      accepts openai | openrouter | qwen | qwen-chat-template | zai, so the
//      provider-family nuance moves to thinking.mode and the wire format
//      collapses to the closest legal value.
//
//   2. efforts — the effort ladder differs per thinking.mode.
//
// Both translations follow the convention already established in the
// hand-written ~/.omp/agent/models.yml catalog, so a generated entry is
// byte-comparable with a hand-tuned one.

// thinking.mode values accepted by omp (observed in pi-coding-agent 17.3.7).
export const OMP_THINKING_MODES = {
  EFFORT: "effort",
  ANTHROPIC_ADAPTIVE: "anthropic-adaptive",
  ANTHROPIC_BUDGET_EFFORT: "anthropic-budget-effort",
  GOOGLE_LEVEL: "google-level",
};

// compat.thinkingFormat values accepted by models.yml.
const LEGAL_THINKING_FORMATS = new Set([
  "openai",
  "openrouter",
  "qwen",
  "qwen-chat-template",
  "zai",
]);

const EFFORTS_FULL = ["minimal", "low", "medium", "high", "xhigh", "max"];
const EFFORTS_ANTHROPIC = ["low", "medium", "high", "max"];
const EFFORTS_GOOGLE = ["minimal", "low", "medium", "high"];

// Gateway thinkingFormat -> { mode, format }.
// `format` is the models.yml-legal compat.thinkingFormat; `mode` carries the
// provider-family behaviour that compat.thinkingFormat cannot express.
const THINKING_TRANSLATION = {
  "claude-adaptive": { mode: OMP_THINKING_MODES.ANTHROPIC_ADAPTIVE, format: "openai" },
  "claude-budget": { mode: OMP_THINKING_MODES.ANTHROPIC_BUDGET_EFFORT, format: "openai" },
  "gemini-level": { mode: OMP_THINKING_MODES.GOOGLE_LEVEL, format: "openai" },
  "gemini-budget": { mode: OMP_THINKING_MODES.GOOGLE_LEVEL, format: "openai" },
  zai: { mode: OMP_THINKING_MODES.EFFORT, format: "zai" },
  qwen: { mode: OMP_THINKING_MODES.EFFORT, format: "qwen" },
  openai: { mode: OMP_THINKING_MODES.EFFORT, format: "openai" },
  kimi: { mode: OMP_THINKING_MODES.EFFORT, format: "openai" },
  minimax: { mode: OMP_THINKING_MODES.EFFORT, format: "openai" },
  deepseek: { mode: OMP_THINKING_MODES.EFFORT, format: "openai" },
  hunyuan: { mode: OMP_THINKING_MODES.EFFORT, format: "openai" },
  step: { mode: OMP_THINKING_MODES.EFFORT, format: "openai" },
};

const EFFORTS_BY_MODE = {
  [OMP_THINKING_MODES.ANTHROPIC_ADAPTIVE]: EFFORTS_ANTHROPIC,
  [OMP_THINKING_MODES.ANTHROPIC_BUDGET_EFFORT]: EFFORTS_ANTHROPIC,
  [OMP_THINKING_MODES.GOOGLE_LEVEL]: EFFORTS_GOOGLE,
  [OMP_THINKING_MODES.EFFORT]: EFFORTS_FULL,
};

/** Translate a gateway thinkingFormat into omp's mode + legal wire format. */
export function translateThinking(thinkingFormat) {
  const known = thinkingFormat ? THINKING_TRANSLATION[thinkingFormat] : null;
  if (known) return known;
  // Unknown/absent format: `effort` + `openai` is the schema-legal default that
  // every OpenAI-compatible endpoint understands.
  const format = LEGAL_THINKING_FORMATS.has(thinkingFormat) ? thinkingFormat : "openai";
  return { mode: OMP_THINKING_MODES.EFFORT, format };
}

const positiveInt = (value) =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : null;

/**
 * Build an omp models.yml model entry from 9Router capabilities.
 *
 * Capability values are copied from the gateway, never invented: a field the
 * gateway does not report is omitted so omp falls back to its own defaults
 * rather than inheriting a fabricated number.
 */
export function buildOmpModelEntry(modelId, capabilities) {
  const caps = capabilities || {};
  const entry = { id: modelId, name: modelId };

  // input modalities — models.yml accepts only "text" | "image".
  const input = ["text"];
  if (caps.vision) input.push("image");
  entry.input = input;

  if (caps.reasoning) entry.reasoning = true;
  // `tools` defaults true in the gateway; only emit an explicit false so a
  // tool-less model (e.g. an image generator) is not offered tools by omp.
  if (caps.tools === false) entry.supportsTools = false;
  else entry.supportsTools = true;

  const contextWindow = positiveInt(caps.contextWindow);
  if (contextWindow) entry.contextWindow = contextWindow;

  const maxTokens = positiveInt(caps.maxOutput);
  if (maxTokens) entry.maxTokens = maxTokens;

  const { mode, format } = translateThinking(caps.thinkingFormat);
  if (caps.reasoning) {
    entry.thinking = { mode, efforts: EFFORTS_BY_MODE[mode] || EFFORTS_FULL };
  }

  entry.compat = {
    maxTokensField: "max_completion_tokens",
    thinkingFormat: format,
    ...(caps.reasoning ? { supportsReasoningEffort: true } : {}),
  };

  return entry;
}

/**
 * Narrow a /api/models `caps` object down to the fields that survive into
 * models.yml. Used by the dashboard before POSTing, so the request body and
 * the written YAML stay in lockstep.
 */
export function toOmpCapabilityPayload(caps) {
  if (!caps) return null;
  const payload = {
    vision: !!caps.vision,
    search: !!caps.search,
    reasoning: !!caps.reasoning,
    tools: caps.tools !== false,
  };
  const contextWindow = positiveInt(caps.contextWindow);
  if (contextWindow) payload.contextWindow = contextWindow;
  const maxOutput = positiveInt(caps.maxOutput);
  if (maxOutput) payload.maxOutput = maxOutput;
  if (caps.thinkingFormat) payload.thinkingFormat = caps.thinkingFormat;
  return payload;
}

/** Compact human label for a context window, e.g. 1000000 -> "1M". */
export function formatContextWindow(value) {
  const n = positiveInt(value);
  if (!n) return null;
  if (n >= 1_000_000) {
    const m = n / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}
