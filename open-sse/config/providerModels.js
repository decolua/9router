import { PROVIDERS } from "./providers.js";

// Global model capabilities registry
// Only define models that have non-default capabilities
// Default: { thinking: false,  multimodal: { image: false, audio: false, video: false, pdf: false } }
export const MODEL_CAPS = {
  // Claude models — full capabilities
  "claude-opus-4-6": { thinking: true, multimodal: { image: true, pdf: true } },
  "claude-sonnet-4-6": { thinking: true, multimodal: { image: true, pdf: true } },
  "claude-opus-4-6-thinking": { thinking: true, multimodal: { image: true, pdf: true } },
  "claude-opus-4-5-20251101": { thinking: true, multimodal: { image: true, pdf: true } },
  "claude-sonnet-4-5-20250929": { thinking: true, multimodal: { image: true, pdf: true } },
  "claude-haiku-4-5-20251001": { multimodal: { image: true } },
  "claude-sonnet-4-20250514": { thinking: true, multimodal: { image: true, pdf: true } },
  "claude-opus-4-20250514": { thinking: true, multimodal: { image: true, pdf: true } },
  "claude-3-5-sonnet-20241022": { multimodal: { image: true } },
  // Cursor Claude aliases
  "claude-4.5-opus-high-thinking": { thinking: true, multimodal: { image: true } },
  "claude-4.5-opus-high": { multimodal: { image: true } },
  "claude-4.5-sonnet-thinking": { thinking: true, multimodal: { image: true } },
  "claude-4.5-sonnet": { multimodal: { image: true } },
  "claude-4.5-haiku": { multimodal: { image: true } },
  "claude-4.5-opus": { multimodal: { image: true } },
  "claude-4.6-opus-max": { thinking: true, multimodal: { image: true } },
  "claude-4.6-sonnet-medium-thinking": { thinking: true, multimodal: { image: true } },
  // GitHub Copilot Claude aliases
  "claude-haiku-4.5": { multimodal: { image: true } },
  "claude-opus-4.1": { thinking: true, multimodal: { image: true } },
  "claude-opus-4.5": { thinking: true, multimodal: { image: true } },
  "claude-sonnet-4": { multimodal: { image: true } },
  "claude-sonnet-4.5": { thinking: true, multimodal: { image: true } },
  "claude-sonnet-4.6": { thinking: true, multimodal: { image: true } },
  "claude-opus-4.6": { thinking: true, multimodal: { image: true } },
  // Kiro aliases
  "claude-sonnet-4.5": { thinking: true, multimodal: { image: true } },

  // Gemini models — full multimodal
  "gemini-3.1-pro-preview": { thinking: true, multimodal: { image: true, audio: true, video: true, pdf: true } },
  "gemini-3.1-flash-lite-preview": { multimodal: { image: true, audio: true, video: true } },
  "gemini-3.1-flash-image-preview": { multimodal: { image: true, audio: true, video: true } },
  "gemini-3-flash-preview": { thinking: true, multimodal: { image: true, audio: true, video: true } },
  "gemini-3-pro-preview": { thinking: true, multimodal: { image: true, audio: true, video: true, pdf: true } },
  "gemini-3-flash": { thinking: true, multimodal: { image: true, audio: true, video: true } },
  "gemini-3.1-pro-high": { thinking: true, multimodal: { image: true, audio: true, video: true, pdf: true } },
  "gemini-3.1-pro-low": { thinking: true, multimodal: { image: true, audio: true, video: true, pdf: true } },
  "gemini-2.5-pro": { thinking: true, multimodal: { image: true, audio: true, video: true, pdf: true } },
  "gemini-2.5-flash": { thinking: true, multimodal: { image: true, audio: true, video: true } },
  "gemini-2.5-flash-lite": { multimodal: { image: true } },
  "gemini-2.0-flash": { multimodal: { image: true, audio: true, video: true } },
  "gemini-2.0-flash-lite": { multimodal: { image: true } },

  // GPT models
  "gpt-5.4": { multimodal: { image: true } },
  "gpt-5.4-mini": { multimodal: { image: true } },
  "gpt-5.3-codex": { thinking: true, multimodal: { image: true } },
  "gpt-5.3-codex-xhigh": { thinking: true },
  "gpt-5.3-codex-high": { thinking: true },
  "gpt-5.3-codex-low": { thinking: true },
  "gpt-5.3-codex-none": {},
  "gpt-5.3-codex-spark": {},
  "gpt-5.2-codex": { thinking: true },
  "gpt-5.2": { multimodal: { image: true } },
  "gpt-5.1-codex": { thinking: true },
  "gpt-5.1-codex-mini": { thinking: true },
  "gpt-5.1-codex-high": { thinking: true },
  "gpt-5.1-codex-max": { thinking: true },
  "gpt-5.1": { multimodal: { image: true } },
  "gpt-5-codex": { thinking: true },
  "gpt-5-codex-mini": {},
  "gpt-5": { multimodal: { image: true } },
  "gpt-5-mini": { multimodal: { image: true } },
  "gpt-4o": { multimodal: { image: true, audio: true } },
  "gpt-4o-mini": { multimodal: { image: true } },
  "gpt-4-turbo": { multimodal: { image: true } },
  "gpt-4.1": { multimodal: { image: true } },
  "gpt-4.1-mini": { multimodal: { image: true } },
  "gpt-4.1-nano": {},
  "o3": { thinking: true, multimodal: { image: true } },
  "o3-mini": { thinking: true },
  "o3-pro": { thinking: true, multimodal: { image: true } },
  "o4-mini": { thinking: true, multimodal: { image: true } },
  "o1": { thinking: true, multimodal: { image: true } },
  "o1-mini": { thinking: true },

  // DeepSeek models
  "deepseek-chat": {},
  "deepseek-reasoner": { thinking: true },
  "deepseek-r1": { thinking: true },
  "deepseek-v3": {},
  "deepseek-v3.1": {},
  "deepseek-v3.2": {},
  "deepseek-3.1": {},
  "deepseek-3.2": {},
  "deepseek-ai/DeepSeek-R1": { thinking: true },
  "deepseek-ai/DeepSeek-V3": {},
  "deepseek-ai/DeepSeek-V3.2": {},
  "deepseek-ai/DeepSeek-V3.1": {},
  "deepseek-ai/deepseek-v3.2-maas": {},

  // Qwen models
  "qwen3-vl-plus": { multimodal: { image: true } },
  "vision-model": { multimodal: { image: true } },
  "qwen3-coder-plus": {},
  "qwen3-coder-flash": {},
  "qwen3-max": { thinking: true },
  "qwen3-max-preview": { thinking: true },
  "qwen3-235b": { thinking: true },
  "qwen3-235b-a22b-instruct": {},
  "qwen3-235b-a22b-thinking-2507": { thinking: true },
  "qwen3-32b": { thinking: true },
  "qwen3-coder-next": {},
  "qwen3.5-plus": {},
  "qwen/qwen3-32b": { thinking: true },
  "qwen/qwen3-next-80b-a3b-thinking-maas": { thinking: true },
  "qwen/qwen3-next-80b-a3b-instruct-maas": {},
  "Qwen/Qwen3-235B-A22B": { thinking: true },
  "Qwen/Qwen3-235B-A22B-Instruct-2507": {},
  "Qwen/Qwen3-Coder-480B-A35B-Instruct": {},
  "Qwen/Qwen3-32B": { thinking: true },
  "qwen-3-235b-a22b-instruct-2507": {},
  "qwen-3-32b": { thinking: true },

  // Kimi models
  "kimi-k2": {},
  "kimi-k2.5": {},
  "kimi-k2.5-thinking": { thinking: true },
  "kimi-latest": {},
  "moonshotai/Kimi-K2.5": {},
  "moonshotai/kimi-k2.5": {},

  // GLM models
  "glm-5.1": {},
  "glm-5": {},
  "glm-4.7": {},
  "glm-4.6v": { multimodal: { image: true } },
  "glm-4.6": {},
  "glm-4.5-air": {},
  "glm-4.7-flash": {},
  "z-ai/glm4.7": {},
  "zai-org/GLM-4.7": {},
  "zai-glm-4.7": {},
  "zai-org/glm-5-maas": {},

  // Grok models
  "grok-4": { thinking: true, multimodal: { image: true } },
  "grok-4-fast-reasoning": { thinking: true },
  "grok-code-fast-1": {},
  "grok-3": { multimodal: { image: true } },

  // GPT-OSS (no toolUse)
  "gpt-oss-120b": {},
  "gpt-oss-120b-medium": {},
  "openai/gpt-oss-120b": {},
  "gpt-oss:120b": {},

  // Llama models
  "meta-llama/Llama-3.3-70B-Instruct-Turbo": {},
  "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8": { multimodal: { image: true } },
  "meta-llama/llama-4-maverick-17b-128e-instruct": { multimodal: { image: true } },
  "meta-llama/Llama-3.3-70B-Instruct": {},
  "meta-llama/Llama-3.2-3B-Instruct": {},
  "llama-3.3-70b-versatile": {},
  "llama-3.3-70b": {},
  "llama-4-scout-17b-16e-instruct": { multimodal: { image: true } },
};

// Default capabilities for unknown models
const DEFAULT_CAPS = { thinking: false, multimodal: { image: false, audio: false, video: false, pdf: false } };

// Merge caps: global as base, provider entry overrides
function mergeCaps(global, override) {
  if (!override) return global;
  return {
    thinking: override.thinking ?? global.thinking,
    multimodal: { ...global.multimodal, ...override.multimodal }
  };
}

// Resolve model capabilities: provider override → global → default
export function getModelCaps(alias, modelId) {
  const entry = PROVIDER_MODELS[alias]?.find(m => m.id === modelId);
  const global = MODEL_CAPS[modelId] ?? DEFAULT_CAPS;
  // Extract caps fields from entry (exclude id, name, type, targetFormat)
  const { id, name, type, targetFormat, ...overrideCaps } = entry || {};
  const hasOverride = Object.keys(overrideCaps).length > 0;
  return mergeCaps({ ...DEFAULT_CAPS, ...global }, hasOverride ? overrideCaps : null);
}

// Provider models - Single source of truth
// Key = alias (cc, cx, gc, qw, if, ag, gh for OAuth; id for API Key)
// Field "provider" for special cases (e.g. AntiGravity models that call different backends)

export const PROVIDER_MODELS = {
  // OAuth Providers (using alias)
  cc: [  // Claude Code
    { id: "claude-opus-4-6", name: "Claude Opus 4.6" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { id: "claude-opus-4-5-20251101", name: "Claude 4.5 Opus" },
    { id: "claude-sonnet-4-5-20250929", name: "Claude 4.5 Sonnet" },
    { id: "claude-haiku-4-5-20251001", name: "Claude 4.5 Haiku" },
  ],
  cx: [  // OpenAI Codex
    { id: "gpt-5.4", name: "GPT 5.4" },
    // GPT 5.3 Codex - all thinking levels
    { id: "gpt-5.3-codex", name: "GPT 5.3 Codex" },
    { id: "gpt-5.3-codex-xhigh", name: "GPT 5.3 Codex (xHigh)" },
    { id: "gpt-5.3-codex-high", name: "GPT 5.3 Codex (High)" },
    { id: "gpt-5.3-codex-low", name: "GPT 5.3 Codex (Low)" },
    { id: "gpt-5.3-codex-none", name: "GPT 5.3 Codex (None)" },
    { id: "gpt-5.3-codex-spark", name: "GPT 5.3 Codex Spark" },
    // Mini - medium and high only
    { id: "gpt-5.1-codex-mini", name: "GPT 5.1 Codex Mini" },
    { id: "gpt-5.1-codex-mini-high", name: "GPT 5.1 Codex Mini (High)" },
    // Other models
    { id: "gpt-5.2-codex", name: "GPT 5.2 Codex" },
    { id: "gpt-5.2", name: "GPT 5.2" },
    { id: "gpt-5.1-codex-max", name: "GPT 5.1 Codex Max" },
    { id: "gpt-5.1-codex", name: "GPT 5.1 Codex" },
    { id: "gpt-5.1", name: "GPT 5.1" },
    { id: "gpt-5-codex", name: "GPT 5 Codex" },
    { id: "gpt-5-codex-mini", name: "GPT 5 Codex Mini" },
  ],
  gc: [  // Gemini CLI
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
    { id: "gemini-3-pro-preview", name: "Gemini 3 Pro Preview" },
  ],
  qw: [  // Qwen Code
    // { id: "qwen3-coder-next", name: "Qwen3 Coder Next" },
    { id: "qwen3-coder-plus", name: "Qwen3 Coder Plus" },
    { id: "qwen3-coder-flash", name: "Qwen3 Coder Flash" },
    { id: "vision-model", name: "Qwen3 Vision Model" },
    { id: "coder-model", name: "Qwen3.5 Coder Model" },
  ],
  if: [  // iFlow AI
    { id: "qwen3-coder-plus", name: "Qwen3 Coder Plus" },
    { id: "qwen3-max", name: "Qwen3 Max" },
    { id: "qwen3-vl-plus", name: "Qwen3 VL Plus" },
    { id: "qwen3-max-preview", name: "Qwen3 Max Preview" },
    { id: "qwen3-235b", name: "Qwen3 235B A22B" },
    { id: "qwen3-235b-a22b-instruct", name: "Qwen3 235B A22B Instruct" },
    { id: "qwen3-235b-a22b-thinking-2507", name: "Qwen3 235B A22B Thinking" },
    { id: "qwen3-32b", name: "Qwen3 32B" },
    { id: "kimi-k2", name: "Kimi K2" },
    { id: "deepseek-v3.2", name: "DeepSeek V3.2 Exp" },
    { id: "deepseek-v3.1", name: "DeepSeek V3.1 Terminus" },
    { id: "deepseek-v3", name: "DeepSeek V3 671B" },
    { id: "deepseek-r1", name: "DeepSeek R1" },
    { id: "glm-4.7", name: "GLM 4.7" },
    { id: "iflow-rome-30ba3b", name: "iFlow ROME" },
  ],
  ag: [  // Antigravity - special case: models call different backends
    { id: "gemini-3.1-pro-high", name: "Gemini 3 Pro High" },
    { id: "gemini-3.1-pro-low", name: "Gemini 3 Pro Low" },
    { id: "gemini-3-flash", name: "Gemini 3 Flash", thinking: false }, // AG strips thinking for this model
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6" },
    { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 Thinking" },
    { id: "gpt-oss-120b-medium", name: "GPT OSS 120B Medium" },
  ],
  gh: [  // GitHub Copilot - OpenAI models
    { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo" },
    { id: "gpt-4", name: "GPT-4" },
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4o-mini", name: "GPT-4o mini" },
    { id: "gpt-4.1", name: "GPT-4.1" },
    { id: "gpt-5", name: "GPT-5" },
    { id: "gpt-5-mini", name: "GPT-5 Mini" },
    { id: "gpt-5-codex", name: "GPT-5 Codex" },
    { id: "gpt-5.1", name: "GPT-5.1" },
    { id: "gpt-5.1-codex", name: "GPT-5.1 Codex" },
    { id: "gpt-5.1-codex-mini", name: "GPT-5.1 Codex Mini" },
    { id: "gpt-5.1-codex-max", name: "GPT-5.1 Codex Max" },
    { id: "gpt-5.2", name: "GPT-5.2" },
    { id: "gpt-5.2-codex", name: "GPT-5.2 Codex" },
    { id: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
    { id: "gpt-5.4", name: "GPT-5.4" },
    // GitHub Copilot - Anthropic models
    { id: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
    { id: "claude-opus-4.1", name: "Claude Opus 4.1" },
    { id: "claude-opus-4.5", name: "Claude Opus 4.5" },
    { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
    { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
    { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
    { id: "claude-opus-4.6", name: "Claude Opus 4.6" },
    // GitHub Copilot - Google models
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash" },
    { id: "gemini-3-pro-preview", name: "Gemini 3 Pro" },
    // GitHub Copilot - Other models
    { id: "grok-code-fast-1", name: "Grok Code Fast 1" },
    { id: "oswe-vscode-prime", name: "Raptor Mini" },
  ],
  kr: [  // Kiro AI
    // { id: "claude-opus-4.5", name: "Claude Opus 4.5" },
    { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
    { id: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
    { id: "deepseek-3.2", name: "DeepSeek 3.2" },
    { id: "deepseek-3.1", name: "DeepSeek 3.1" },
    { id: "qwen3-coder-next", name: "Qwen3 Coder Next" },
  ],
  cu: [  // Cursor IDE
    { id: "default", name: "Auto (Server Picks)" },
    { id: "claude-4.5-opus-high-thinking", name: "Claude 4.5 Opus High Thinking" },
    { id: "claude-4.5-opus-high", name: "Claude 4.5 Opus High" },
    { id: "claude-4.5-sonnet-thinking", name: "Claude 4.5 Sonnet Thinking" },
    { id: "claude-4.5-sonnet", name: "Claude 4.5 Sonnet" },
    { id: "claude-4.5-haiku", name: "Claude 4.5 Haiku" },
    { id: "claude-4.5-opus", name: "Claude 4.5 Opus" },
    { id: "gpt-5.2-codex", name: "GPT 5.2 Codex" },
    { id: "claude-4.6-opus-max", name: "Claude 4.6 Opus Max" },
    { id: "claude-4.6-sonnet-medium-thinking", name: "Claude 4.6 Sonnet Medium Thinking" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
    { id: "gpt-5.2", name: "GPT 5.2" },
    { id: "gpt-5.3-codex", name: "GPT 5.3 Codex" },
  ],
  kmc: [  // Kimi Coding
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "kimi-k2.5-thinking", name: "Kimi K2.5 Thinking" },
    { id: "kimi-latest", name: "Kimi Latest" },
  ],
  kc: [  // KiloCode
    { id: "anthropic/claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
    { id: "anthropic/claude-opus-4-20250514", name: "Claude Opus 4" },
    { id: "google/gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "google/gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "openai/gpt-4.1", name: "GPT-4.1" },
    { id: "openai/o3", name: "o3" },
    { id: "deepseek/deepseek-chat", name: "DeepSeek Chat" },
    { id: "deepseek/deepseek-reasoner", name: "DeepSeek Reasoner" },
  ],
  cl: [  // Cline
    { id: "anthropic/claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
    { id: "anthropic/claude-opus-4.6", name: "Claude Opus 4.6" },
    { id: "openai/gpt-5.3-codex", name: "GPT-5.3 Codex" },
    { id: "openai/gpt-5.4", name: "GPT-5.4" },
    { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
    { id: "google/gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite Preview" },
    { id: "kwaipilot/kat-coder-pro", name: "KAT Coder Pro" },
  ],

  // API Key Providers (alias = id)
  openai: [
    // Flagship models
    { id: "gpt-5.4", name: "GPT-5.4" },
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    { id: "gpt-5.4-nano", name: "GPT-5.4 Nano" },
    { id: "gpt-5.2", name: "GPT-5.2" },
    { id: "gpt-5.1", name: "GPT-5.1" },
    { id: "gpt-5", name: "GPT-5" },
    { id: "gpt-5-mini", name: "GPT-5 Mini" },
    { id: "gpt-5-nano", name: "GPT-5 Nano" },
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
    { id: "gpt-4.1", name: "GPT-4.1" },
    { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
    { id: "gpt-4.1-nano", name: "GPT-4.1 Nano" },
    // Reasoning models
    { id: "o3", name: "O3" },
    { id: "o3-mini", name: "O3 Mini" },
    { id: "o3-pro", name: "O3 Pro" },
    { id: "o4-mini", name: "O4 Mini" },
    { id: "o1", name: "O1" },
    { id: "o1-mini", name: "O1 Mini" },
    // Embedding models
    { id: "text-embedding-3-large", name: "Text Embedding 3 Large", type: "embedding" },
    { id: "text-embedding-3-small", name: "Text Embedding 3 Small", type: "embedding" },
    { id: "text-embedding-ada-002", name: "Text Embedding Ada 002", type: "embedding" },
    // TTS models
    { id: "tts-1", name: "TTS-1", type: "tts" },
    { id: "tts-1-hd", name: "TTS-1 HD", type: "tts" },
    { id: "gpt-4o-mini-tts", name: "GPT-4o Mini TTS", type: "tts" },
  ],
  anthropic: [
    { id: "claude-sonnet-4-20250514", name: "Claude Sonnet 4" },
    { id: "claude-opus-4-20250514", name: "Claude Opus 4" },
    { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
  ],
  gemini: [
    // Gemini 3.1 series
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
    { id: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite Preview" },
    { id: "gemini-3.1-flash-image-preview", name: "Gemini 3.1 Flash Image Preview" },
    // Gemini 3 series
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
    // Gemini 2.5 series
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite" },
    // Gemini 2.0 series (retiring June 1, 2026)
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
    { id: "gemini-2.0-flash-lite", name: "Gemini 2.0 Flash Lite" },
    // Embedding models
    { id: "gemini-embedding-2-preview", name: "Gemini Embedding 2 Preview", type: "embedding" },
    { id: "gemini-embedding-001", name: "Gemini Embedding 001", type: "embedding" },
    { id: "text-embedding-005", name: "Text Embedding 005", type: "embedding" },
    { id: "text-embedding-004", name: "Text Embedding 004 (Legacy)", type: "embedding" },
  ],
  openrouter: [],
  glm: [
    { id: "glm-5.1", name: "GLM 5.1" },
    { id: "glm-5", name: "GLM 5" },
    { id: "glm-4.7", name: "GLM 4.7" },
    { id: "glm-4.6v", name: "GLM 4.6V (Vision)" },
  ],
  "glm-cn": [
    { id: "glm-5.1", name: "GLM 5.1" },
    { id: "glm-5", name: "GLM 5" },
    { id: "glm-4.7", name: "GLM-4.7" },
    { id: "glm-4.6", name: "GLM-4.6" },
    { id: "glm-4.5-air", name: "GLM-4.5-Air" },
  ],
  kimi: [
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "kimi-k2.5-thinking", name: "Kimi K2.5 Thinking" },
    { id: "kimi-latest", name: "Kimi Latest" },
  ],
  minimax: [
    { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
    { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
    { id: "MiniMax-M2.1", name: "MiniMax M2.1" },
  ],
  "minimax-cn": [
    { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
    { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
    { id: "MiniMax-M2.1", name: "MiniMax M2.1" },
  ],
  alicode: [
    { id: "qwen3.5-plus", name: "Qwen3.5 Plus" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "glm-5", name: "GLM 5" },
    { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
    { id: "qwen3-max-2026-01-23", name: "Qwen3 Max" },
    { id: "qwen3-coder-next", name: "Qwen3 Coder Next" },
    { id: "qwen3-coder-plus", name: "Qwen3 Coder Plus" },
    { id: "glm-4.7", name: "GLM 4.7" },
  ],
  "alicode-intl": [
    { id: "qwen3.5-plus", name: "Qwen3.5 Plus" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "glm-5", name: "GLM 5" },
    { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
    { id: "qwen3-coder-next", name: "Qwen3 Coder Next" },
    { id: "qwen3-coder-plus", name: "Qwen3 Coder Plus" },
    { id: "glm-4.7", name: "GLM 4.7" },
  ],
  deepseek: [
    { id: "deepseek-chat", name: "DeepSeek V3.2 Chat" },
    { id: "deepseek-reasoner", name: "DeepSeek V3.2 Reasoner" },
  ],
  groq: [
    { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
    { id: "meta-llama/llama-4-maverick-17b-128e-instruct", name: "Llama 4 Maverick" },
    { id: "qwen/qwen3-32b", name: "Qwen3 32B" },
    { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B" },
  ],
  xai: [
    { id: "grok-4", name: "Grok 4" },
    { id: "grok-4-fast-reasoning", name: "Grok 4 Fast Reasoning" },
    { id: "grok-code-fast-1", name: "Grok Code Fast" },
    { id: "grok-3", name: "Grok 3" },
  ],
  mistral: [
    { id: "mistral-large-latest", name: "Mistral Large 3" },
    { id: "codestral-latest", name: "Codestral" },
    { id: "mistral-medium-latest", name: "Mistral Medium 3" },
  ],
  perplexity: [
    { id: "sonar-pro", name: "Sonar Pro" },
    { id: "sonar", name: "Sonar" },
  ],
  together: [
    { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", name: "Llama 3.3 70B Turbo" },
    { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1" },
    { id: "Qwen/Qwen3-235B-A22B", name: "Qwen3 235B" },
    { id: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8", name: "Llama 4 Maverick" },
  ],
  fireworks: [
    { id: "accounts/fireworks/models/deepseek-v3p1", name: "DeepSeek V3.1" },
    { id: "accounts/fireworks/models/llama-v3p3-70b-instruct", name: "Llama 3.3 70B" },
    { id: "accounts/fireworks/models/qwen3-235b-a22b", name: "Qwen3 235B" },
  ],
  cerebras: [
    { id: "gpt-oss-120b", name: "GPT OSS 120B" },
    { id: "zai-glm-4.7", name: "ZAI GLM 4.7" },
    { id: "llama-3.3-70b", name: "Llama 3.3 70B" },
    { id: "llama-4-scout-17b-16e-instruct", name: "Llama 4 Scout" },
    { id: "qwen-3-235b-a22b-instruct-2507", name: "Qwen3 235B A22B" },
    { id: "qwen-3-32b", name: "Qwen3 32B" },
  ],
  cohere: [
    { id: "command-r-plus-08-2024", name: "Command R+ (Aug 2024)" },
    { id: "command-r-08-2024", name: "Command R (Aug 2024)" },
    { id: "command-a-03-2025", name: "Command A (Mar 2025)" },
  ],
  nvidia: [
    { id: "moonshotai/kimi-k2.5", name: "Kimi K2.5" },
    { id: "z-ai/glm4.7", name: "GLM 4.7" },
  ],
  nebius: [
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B Instruct" },
  ],
  siliconflow: [
    { id: "deepseek-ai/DeepSeek-V3.2", name: "DeepSeek V3.2" },
    { id: "deepseek-ai/DeepSeek-V3.1", name: "DeepSeek V3.1" },
    { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1" },
    { id: "Qwen/Qwen3-235B-A22B-Instruct-2507", name: "Qwen3 235B" },
    { id: "Qwen/Qwen3-Coder-480B-A35B-Instruct", name: "Qwen3 Coder 480B" },
    { id: "Qwen/Qwen3-32B", name: "Qwen3 32B" },
    { id: "moonshotai/Kimi-K2.5", name: "Kimi K2.5" },
    { id: "zai-org/GLM-4.7", name: "GLM 4.7" },
    { id: "openai/gpt-oss-120b", name: "GPT OSS 120B" },
    { id: "baidu/ERNIE-4.5-300B-A47B", name: "ERNIE 4.5 300B" },
  ],
  hyperbolic: [
    { id: "Qwen/QwQ-32B", name: "QwQ 32B" },
    { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1" },
    { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3" },
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B" },
    { id: "meta-llama/Llama-3.2-3B-Instruct", name: "Llama 3.2 3B" },
    { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B" },
    { id: "Qwen/Qwen2.5-Coder-32B-Instruct", name: "Qwen 2.5 Coder 32B" },
    { id: "NousResearch/Hermes-3-Llama-3.1-70B", name: "Hermes 3 70B" },
  ],
  ollama: [
    { id: "gpt-oss:120b", name: "GPT OSS 120B" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "glm-5", name: "GLM 5" },
    { id: "minimax-m2.5", name: "MiniMax M2.5" },
    { id: "glm-4.7-flash", name: "GLM 4.7 Flash" },
    { id: "qwen3.5", name: "Qwen3.5" },
  ],
  vertex: [
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview" },
    { id: "gemini-3.1-flash-lite-preview", name: "Gemini 3.1 Flash Lite Preview" },
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
  ],
  "vertex-partner": [
    { id: "deepseek-ai/deepseek-v3.2-maas", name: "DeepSeek V3.2 (Vertex)" },
    { id: "qwen/qwen3-next-80b-a3b-thinking-maas", name: "Qwen3 Next 80B Thinking (Vertex)" },
    { id: "qwen/qwen3-next-80b-a3b-instruct-maas", name: "Qwen3 Next 80B Instruct (Vertex)" },
    { id: "zai-org/glm-5-maas", name: "GLM-5 (Vertex)" },
  ],
};

// Helper functions
export function getProviderModels(aliasOrId) {
  return PROVIDER_MODELS[aliasOrId] || [];
}

export function getDefaultModel(aliasOrId) {
  const models = PROVIDER_MODELS[aliasOrId];
  return models?.[0]?.id || null;
}

export function isValidModel(aliasOrId, modelId, passthroughProviders = new Set()) {
  if (passthroughProviders.has(aliasOrId)) return true;
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return false;
  return models.some(m => m.id === modelId);
}

export function findModelName(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return modelId;
  const found = models.find(m => m.id === modelId);
  return found?.name || modelId;
}

export function getModelTargetFormat(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  if (!models) return null;
  const found = models.find(m => m.id === modelId);
  return found?.targetFormat || null;
}

// OAuth providers that use short aliases (everything else: alias = id)
const OAUTH_ALIASES = {
  claude: "cc",
  codex: "cx",
  "gemini-cli": "gc",
  qwen: "qw",
  iflow: "if",
  antigravity: "ag",
  github: "gh",
  kiro: "kr",
  cursor: "cu",
  "kimi-coding": "kmc",
  kilocode: "kc",
  cline: "cl",
  vertex: "vertex",
  "vertex-partner": "vertex-partner",
};

// Derived from PROVIDERS — no need to maintain manually
export const PROVIDER_ID_TO_ALIAS = Object.fromEntries(
  Object.keys(PROVIDERS).map(id => [id, OAUTH_ALIASES[id] || id])
);

export function getModelsByProviderId(providerId) {
  const alias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
  return PROVIDER_MODELS[alias] || [];
}

// Re-export getModelCaps here for convenience (defined above PROVIDER_MODELS)
// getModelCaps is already exported above
