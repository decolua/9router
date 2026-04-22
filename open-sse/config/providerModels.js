import { PROVIDERS } from "./providers.js";
import { buildTtsProviderModels } from "./ttsModels.js";

// Provider models - Single source of truth
// Key = alias (cc, cx, gc, qw, if, ag, gh for OAuth; id for API Key)
// Field "provider" for special cases (e.g. AntiGravity models that call different backends)

export const PROVIDER_MODELS = {
  // OAuth Providers (using alias)
  cc: [  // Claude Code
    { id: "claude-opus-4-7", name: "Claude Opus 4.7" },
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
    { id: "coder-model", name: "Qwen3.6 Coder Model" },
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
    { id: "gpt-5-mini", name: "GPT-5 Mini" },
    { id: "gpt-5.2", name: "GPT-5.2" },
    { id: "gpt-5.2-codex", name: "GPT-5.2 Codex" },
    { id: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
    { id: "gpt-5.4", name: "GPT-5.4" },
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
    // GitHub Copilot - Anthropic models
    { id: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
    { id: "claude-opus-4.5", name: "Claude Opus 4.5" },
    { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
    { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
    { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
    { id: "claude-opus-4.6", name: "Claude Opus 4.6" },
    { id: "claude-opus-4.7", name: "Claude Opus 4.7" },
    // GitHub Copilot - Google models
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro" },
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash" },
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro" },
    // GitHub Copilot - Other models
    { id: "grok-code-fast-1", name: "Grok Code Fast 1" },
    { id: "oswe-vscode-prime", name: "Raptor Mini" },
    { id: "goldeneye-free-auto", name: "GoldenEye" },
  ],
  kr: [  // Kiro AI
    // { id: "claude-opus-4.5", name: "Claude Opus 4.5" },
    { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
    { id: "claude-haiku-4.5", name: "Claude Haiku 4.5" },
    { id: "deepseek-3.2", name: "DeepSeek 3.2", strip: ["image", "audio"] },
    { id: "qwen3-coder-next", name: "Qwen3 Coder Next", strip: ["image", "audio"] },
    { id: "glm-5", name: "GLM 5" },
    { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
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
  "opencode-go": [  // OpenCode Go subscription (API key)
    { id: "kimi-k2.6", name: "Kimi K2.6" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "glm-5.1", name: "GLM 5.1" },
    { id: "glm-5", name: "GLM 5" },
    { id: "qwen3.5-plus", name: "Qwen 3.5 Plus" },
    { id: "qwen3.6-plus", name: "Qwen 3.6 Plus" },
    { id: "mimo-v2-pro", name: "MiMo V2 Pro" },
    { id: "mimo-v2-omni", name: "MiMo V2 Omni" },
    { id: "minimax-m2.7", name: "MiniMax M2.7", targetFormat: "claude" },
    { id: "minimax-m2.5", name: "MiniMax M2.5", targetFormat: "claude" },
  ],
  oc: [  // OpenCode
    // { id: "nemotron-3-super-free", name: "Nemotron 3 Super" },
    // { id: "qwen3.6-plus-free", name: "Qwen 3.6 Plus" },
    // { id: "big-pickle", name: "Big Pickle", targetFormat: "claude" },
    // { id: "minimax-m2.5-free", name: "MiniMax M2.5", targetFormat: "claude" },
    // { id: "trinity-large-preview-free", name: "Trinity Large Preview" },
  ],

  cl: [  // Cline
    { id: "anthropic/claude-opus-4.7", name: "Claude Opus 4.7" },
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
    // Image models
    { id: "gpt-image-1", name: "GPT Image 1", type: "image" },
    { id: "dall-e-3", name: "DALL-E 3", type: "image" },
    { id: "dall-e-2", name: "DALL-E 2", type: "image" },
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
    // Image models (Nano Banana)
    { id: "gemini-3.1-flash-image-preview", name: "Gemini 3.1 Flash Image (Nano Banana 2)", type: "image" },
    { id: "gemini-3-pro-image-preview", name: "Gemini 3 Pro Image (Nano Banana Pro)", type: "image" },
    { id: "gemini-2.5-flash-image", name: "Gemini 2.5 Flash Image (Nano Banana)", type: "image" },
  ],
  openrouter: [
    // Embedding models
    { id: "openai/text-embedding-3-large", name: "OpenAI Text Embedding 3 Large", type: "embedding" },
    { id: "openai/text-embedding-3-small", name: "OpenAI Text Embedding 3 Small", type: "embedding" },
    { id: "openai/text-embedding-ada-002", name: "OpenAI Text Embedding Ada 002", type: "embedding" },
    { id: "qwen/qwen3-embedding-8b", name: "Qwen3 Embedding 8B", type: "embedding" },
    { id: "perplexity/pplx-embed-v1-4b", name: "Perplexity Embed V1 4B", type: "embedding" },
    { id: "perplexity/pplx-embed-v1-0.6b", name: "Perplexity Embed V1 0.6B", type: "embedding" },
    { id: "nvidia/llama-nemotron-embed-vl-1b-v2:free", name: "NVIDIA Nemotron Embed VL 1B V2 (Free)", type: "embedding" },
    // TTS models
    { id: "openai/gpt-4o-mini-tts", name: "GPT-4o Mini TTS", type: "tts" },
    { id: "openai/tts-1-hd",        name: "TTS-1 HD",        type: "tts" },
    { id: "openai/tts-1",           name: "TTS-1",           type: "tts" },
    // Image models
    { id: "openai/dall-e-3", name: "DALL-E 3 (via OpenRouter)", type: "image" },
    { id: "openai/gpt-image-1", name: "GPT Image 1 (via OpenRouter)", type: "image" },
    { id: "google/imagen-3.0-generate-002", name: "Imagen 3 (via OpenRouter)", type: "image" },
    { id: "black-forest-labs/FLUX.1-schnell", name: "FLUX.1 Schnell (via OpenRouter)", type: "image" },
  ],
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
    // Image models
    { id: "minimax-image-01", name: "MiniMax Image 01", type: "image" },
  ],
  blackbox: [
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4o-mini", name: "GPT-4o mini" },
    { id: "claude-sonnet-4.6", name: "Claude Sonnet 4.6" },
    { id: "claude-sonnet-4.5", name: "Claude Sonnet 4.5" },
    { id: "claude-opus-4.6", name: "Claude Opus 4.6" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Legacy)" },
    { id: "claude-opus-4-6", name: "Claude Opus 4.6 (Legacy)" },
    { id: "deepseek-chat", name: "DeepSeek Chat" },
    { id: "deepseek-v3-671b", name: "DeepSeek V3 671B" },
    { id: "deepseek-r1", name: "DeepSeek R1" },
    { id: "o1", name: "OpenAI o1" },
    { id: "o3-mini", name: "OpenAI o3-mini" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" },
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview" },
    { id: "qwen3-coder-plus", name: "Qwen3 Coder Plus" },
    { id: "qwen3-max", name: "Qwen3 Max" },
    { id: "qwen3-vl-plus", name: "Qwen3 VL Plus" },
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
  "grok-web": [
    { id: "grok-3", name: "Grok 3" },
    { id: "grok-3-mini", name: "Grok 3 Mini (Thinking)" },
    { id: "grok-3-thinking", name: "Grok 3 Thinking" },
    { id: "grok-4", name: "Grok 4" },
    { id: "grok-4-mini", name: "Grok 4 Mini (Thinking)" },
    { id: "grok-4-thinking", name: "Grok 4 Thinking" },
    { id: "grok-4-heavy", name: "Grok 4 Heavy (SuperGrok)" },
    { id: "grok-4.1-mini", name: "Grok 4.1 Mini (Thinking)" },
    { id: "grok-4.1-fast", name: "Grok 4.1 Fast" },
    { id: "grok-4.1-expert", name: "Grok 4.1 Expert" },
    { id: "grok-4.1-thinking", name: "Grok 4.1 Thinking" },
    { id: "grok-4.2", name: "Grok 4.2 (4.20 Beta)" },
  ],
  "perplexity-web": [
    { id: "pplx-auto", name: "Perplexity Auto (Free)" },
    { id: "pplx-sonar", name: "Perplexity Sonar" },
    { id: "pplx-gpt", name: "GPT-5.4 (via Perplexity)" },
    { id: "pplx-gemini", name: "Gemini 3.1 Pro (via Perplexity)" },
    { id: "pplx-sonnet", name: "Claude Sonnet 4.6 (via Perplexity)" },
    { id: "pplx-opus", name: "Claude Opus 4.6 (via Perplexity)" },
    { id: "pplx-nemotron", name: "Nemotron 3 Super (via Perplexity)" },
  ],

  // TTS entries are loaded from ttsModels.js via buildTtsProviderModels()
  ...buildTtsProviderModels(),

  // Image providers
  nanobanana: [
    { id: "nanobanana-flash", name: "NanoBanana Flash", type: "image" },
    { id: "nanobanana-pro", name: "NanoBanana Pro", type: "image" },
  ],
  sdwebui: [
    { id: "stable-diffusion-v1-5", name: "Stable Diffusion v1.5", type: "image" },
    { id: "sdxl-base-1.0", name: "SDXL Base 1.0", type: "image" },
  ],
  comfyui: [
    { id: "flux-dev", name: "FLUX Dev", type: "image" },
    { id: "sdxl", name: "SDXL", type: "image" },
  ],
  huggingface: [
    { id: "black-forest-labs/FLUX.1-schnell", name: "FLUX.1 Schnell", type: "image" },
    { id: "stabilityai/stable-diffusion-xl-base-1.0", name: "SDXL Base 1.0", type: "image" },
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
