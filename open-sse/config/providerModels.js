import { PROVIDERS } from "./providers.js";

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
    { id: "deepseek-3.2", name: "DeepSeek 3.2", strip: ["image", "audio"] },
    { id: "deepseek-3.1", name: "DeepSeek 3.1", strip: ["image", "audio"] },
    { id: "qwen3-coder-next", name: "Qwen3 Coder Next", strip: ["image", "audio"] },
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
  oc: [  // OpenCode
    { id: "nemotron-3-super-free", name: "Nemotron 3 Super" },
    // { id: "qwen3.6-plus-free", name: "Qwen 3.6 Plus" },
    // { id: "big-pickle", name: "Big Pickle", targetFormat: "claude" },
    { id: "minimax-m2.5-free", name: "MiniMax M2.5", targetFormat: "claude" },
    // { id: "trinity-large-preview-free", name: "Trinity Large Preview" },
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
    { id: "gemma-4-31b-it", name: "Gemma 4 31B IT" },

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

  // Free/noAuth TTS providers
  "local-device": [
    { id: "default", name: "System Default Voice", type: "tts" },
  ],
  "google-tts": [
    { id: "en", name: "English", type: "tts" },
    { id: "vi", name: "Vietnamese", type: "tts" },
    { id: "zh-CN", name: "Chinese (Simplified)", type: "tts" },
    { id: "fr", name: "French", type: "tts" },
    { id: "de", name: "German", type: "tts" },
    { id: "ja", name: "Japanese", type: "tts" },
    { id: "ko", name: "Korean", type: "tts" },
  ],
  // OpenAI TTS voices (hardcoded — no public API to list them)
  // Used by ttsCore.js when provider = openai
  "openai-tts-voices": [
    { id: "alloy",   name: "Alloy",   type: "tts" },
    { id: "ash",     name: "Ash",     type: "tts" },
    { id: "ballad",  name: "Ballad",  type: "tts" },
    { id: "cedar",   name: "Cedar",   type: "tts" },
    { id: "coral",   name: "Coral",   type: "tts" },
    { id: "echo",    name: "Echo",    type: "tts" },
    { id: "fable",   name: "Fable",   type: "tts" },
    { id: "marin",   name: "Marin",   type: "tts" },
    { id: "nova",    name: "Nova",    type: "tts" },
    { id: "onyx",    name: "Onyx",    type: "tts" },
    { id: "sage",    name: "Sage",    type: "tts" },
    { id: "shimmer", name: "Shimmer", type: "tts" },
    { id: "verse",   name: "Verse",   type: "tts" },
  ],
  // OpenAI TTS models
  "openai-tts-models": [
    { id: "gpt-4o-mini-tts", name: "GPT-4o Mini TTS", type: "tts" },
    { id: "tts-1-hd",        name: "TTS-1 HD",        type: "tts" },
    { id: "tts-1",           name: "TTS-1",           type: "tts" },
  ],
  // ElevenLabs TTS models
  "elevenlabs-tts-models": [
    { id: "eleven_flash_v2_5",       name: "Flash v2.5 (Fastest)",     type: "tts" },
    { id: "eleven_turbo_v2_5",       name: "Turbo v2.5 (Fast)",        type: "tts" },
    { id: "eleven_multilingual_v2",  name: "Multilingual v2 (Quality)", type: "tts" },
    { id: "eleven_monolingual_v1",   name: "Monolingual v1 (English)", type: "tts" },
  ],
  "edge-tts": [
    { id: "en-US-AriaNeural", name: "Aria (en-US)", type: "tts" },
    { id: "en-US-GuyNeural", name: "Guy (en-US)", type: "tts" },
    { id: "en-GB-SoniaNeural", name: "Sonia (en-GB)", type: "tts" },
    { id: "vi-VN-HoaiMyNeural", name: "Hoai My (vi-VN)", type: "tts" },
    { id: "vi-VN-NamMinhNeural", name: "Nam Minh (vi-VN)", type: "tts" },
    { id: "zh-CN-XiaoxiaoNeural", name: "Xiaoxiao (zh-CN)", type: "tts" },
    { id: "zh-CN-YunxiNeural", name: "Yunxi (zh-CN)", type: "tts" },
    { id: "fr-FR-DeniseNeural", name: "Denise (fr-FR)", type: "tts" },
    { id: "de-DE-KatjaNeural", name: "Katja (de-DE)", type: "tts" },
    { id: "ja-JP-NanamiNeural", name: "Nanami (ja-JP)", type: "tts" },
    { id: "ko-KR-SunHiNeural", name: "SunHi (ko-KR)", type: "tts" },
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
  opencode: "oc",
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

// Get strip list for a model entry (explicit opt-in only)
// Returns array of content types to strip, e.g. ["image", "audio"]
export function getModelStrip(alias, modelId) {
  const entry = PROVIDER_MODELS[alias]?.find(m => m.id === modelId);
  return entry?.strip || [];
}
