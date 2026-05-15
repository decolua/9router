import { PROVIDERS } from "./providers.js";
import { buildTtsProviderModels } from "./ttsModels.js";

// Provider models - Single source of truth
// Key = alias (cc, cx, gc, qw, if, ag, gh for OAuth; id for API Key)
// Field "provider" for special cases (e.g. AntiGravity models that call different backends)

const CODEX_REVIEW_SUFFIX = "-review";

function withCodexReviewModels(models) {
  return models.flatMap((model) => {
    if ((model.type || "llm") !== "llm" || model.id.endsWith(CODEX_REVIEW_SUFFIX)) {
      return [model];
    }

    return [
      model,
      {
        ...model,
        id: `${model.id}${CODEX_REVIEW_SUFFIX}`,
        name: `${model.name} Review`,
        upstreamModelId: model.upstreamModelId || model.id,
        quotaFamily: "review",
      },
    ];
  });
}

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
  cx: withCodexReviewModels([  // OpenAI Codex
    { id: "gpt-5.5", name: "GPT 5.5" },
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
    // Image models (uses image_generation tool, requires Plus/Pro plan)
    { id: "gpt-5.5-image", name: "GPT 5.5 Image", type: "image", capabilities: ["text2img", "edit"], params: ["size", "quality", "background", "image_detail", "output_format"] },
    { id: "gpt-5.4-image", name: "GPT 5.4 Image", type: "image", capabilities: ["text2img", "edit"], params: ["size", "quality", "background", "image_detail", "output_format"] },
    { id: "gpt-5.3-image", name: "GPT 5.3 Image", type: "image", capabilities: ["text2img", "edit"], params: ["size", "quality", "background", "image_detail", "output_format"] },
    { id: "gpt-5.2-image", name: "GPT 5.2 Image", type: "image", capabilities: ["text2img", "edit"], params: ["size", "quality", "background", "image_detail", "output_format"] },
  ]),
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
    // GitHub Copilot - Embedding models
    { id: "text-embedding-3-small", name: "Text Embedding 3 Small (GitHub)", type: "embedding" },
    { id: "text-embedding-3-large", name: "Text Embedding 3 Large (GitHub)", type: "embedding" },
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
    { id: "kimi-k2.6", name: "Kimi K2.6" },
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
    // STT models
    { id: "whisper-1", name: "Whisper 1", type: "stt", params: ["language", "response_format", "temperature", "prompt"] },
    { id: "gpt-4o-transcribe", name: "GPT-4o Transcribe", type: "stt", params: ["language", "response_format", "temperature", "prompt"] },
    { id: "gpt-4o-mini-transcribe", name: "GPT-4o Mini Transcribe", type: "stt", params: ["language", "response_format", "temperature", "prompt"] },
    // Image models
    { id: "gpt-image-1", name: "GPT Image 1", type: "image", params: ["n", "size", "quality", "response_format"] },
    { id: "dall-e-3", name: "DALL-E 3", type: "image", params: ["size", "quality", "style", "response_format"] },
    { id: "dall-e-2", name: "DALL-E 2", type: "image", params: ["n", "size", "response_format"] },
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
    { id: "gemini-3.1-flash-image-preview", name: "Gemini 3.1 Flash Image (Nano Banana 2)", type: "image", params: [] },
    { id: "gemini-3-pro-image-preview", name: "Gemini 3 Pro Image (Nano Banana Pro)", type: "image", params: [] },
    { id: "gemini-2.5-flash-image", name: "Gemini 2.5 Flash Image (Nano Banana)", type: "image", params: [] },
    // STT models (multimodal generateContent)
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro (Best)", type: "stt", params: ["language", "prompt"] },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", type: "stt", params: ["language", "prompt"] },
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite (Cheapest)", type: "stt", params: ["language", "prompt"] },
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", type: "stt", params: ["language", "prompt"] },
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
    { id: "openai/dall-e-3", name: "DALL-E 3 (via OpenRouter)", type: "image", params: ["size", "quality", "style", "response_format"] },
    { id: "openai/gpt-image-1", name: "GPT Image 1 (via OpenRouter)", type: "image", params: ["n", "size", "quality", "response_format"] },
    { id: "google/imagen-3.0-generate-002", name: "Imagen 3 (via OpenRouter)", type: "image", params: ["n", "size"] },
    { id: "black-forest-labs/FLUX.1-schnell", name: "FLUX.1 Schnell (via OpenRouter)", type: "image", params: ["n", "size"] },
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
    { id: "kimi-k2.6", name: "Kimi K2.6" },
    { id: "kimi-k2.5", name: "Kimi K2.5" },
    { id: "kimi-k2.5-thinking", name: "Kimi K2.5 Thinking" },
    { id: "kimi-latest", name: "Kimi Latest" },
  ],
  minimax: [
    { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
    { id: "MiniMax-M2.5", name: "MiniMax M2.5" },
    { id: "MiniMax-M2.1", name: "MiniMax M2.1" },
    // Image models
    { id: "minimax-image-01", name: "MiniMax Image 01", type: "image", params: ["n", "size", "response_format"] },
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
  "volcengine-ark": [
    { id: "Doubao-Seed-2.0-Code", name: "Doubao-Seed-2.0-Code" },
    { id: "Doubao-Seed-2.0-pro", name: "Doubao-Seed-2.0-pro" },
    { id: "Doubao-Seed-2.0-lite", name: "Doubao-Seed-2.0-lite" },
    { id: "Doubao-Seed-Code", name: "Doubao-Seed-Code" },
    { id: "GLM-5.1", name: "GLM-5.1" },
    { id: "MiniMax-M2.7", name: "MiniMax-M2.7" },
    { id: "Kimi-K2.6", name: "Kimi-K2.6" },
    { id: "MiniMax-M2.5", name: "MiniMax-M2.5" },
    { id: "Kimi-K2.5", name: "Kimi-K2.5" },
    { id: "GLM-4.7", name: "GLM-4.7" },
    { id: "DeepSeek-V3.2", name: "DeepSeek-V3.2" },
  ],
  "cloudflare-ai": [
    { id: "@cf/meta/llama-3.2-1b-instruct", name: "Llama 3.2 1B Instruct" },
    { id: "@cf/meta/llama-3.2-3b-instruct", name: "Llama 3.2 3B Instruct" },
    { id: "@cf/meta/llama-3.1-8b-instruct-fp8-fast", name: "Llama 3.1 8B Instruct FP8 Fast" },
    { id: "@cf/meta/llama-3.1-8b-instruct-awq", name: "Llama 3.1 8B Instruct AWQ" },
    { id: "@cf/mistralai/mistral-small-3.1-24b-instruct", name: "Mistral Small 3.1 24B Instruct" },
    { id: "@cf/meta/llama-3.1-70b-instruct-fp8-fast", name: "Llama 3.1 70B Instruct FP8 Fast" },
    { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", name: "Llama 3.3 70B Instruct FP8 Fast" },
    { id: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", name: "DeepSeek R1 Distill Qwen 32B" },
    { id: "@cf/moonshotai/kimi-k2.5", name: "Kimi K2.5" },
    { id: "@cf/moonshotai/kimi-k2.6", name: "Kimi K2.6" },
    { id: "@cf/zai-org/glm-4.7-flash", name: "GLM 4.7 Flash" },
    { id: "@cf/qwen/qwq-32b", name: "QwQ 32B" },
    { id: "@cf/qwen/qwen2.5-coder-32b-instruct", name: "Qwen 2.5 Coder 32B Instruct" },
    { id: "@cf/black-forest-labs/flux-2-klein-9b", name: "FLUX.2 Klein 9B", type: "image", params: ["size"] },
    { id: "@cf/black-forest-labs/flux-2-klein-4b", name: "FLUX.2 Klein 4B", type: "image", params: ["size"] },
    { id: "@cf/black-forest-labs/flux-2-dev", name: "FLUX.2 Dev", type: "image", params: ["size"] },
    { id: "@cf/leonardo/lucid-origin", name: "Lucid Origin", type: "image", params: ["size"] },
    { id: "@cf/leonardo/phoenix-1.0", name: "Phoenix 1.0", type: "image", params: ["size"] },
    { id: "@cf/black-forest-labs/flux-1-schnell", name: "FLUX.1 Schnell", type: "image", params: ["size"] },
    { id: "@cf/bytedance/stable-diffusion-xl-lightning", name: "SDXL Lightning", type: "image", params: ["size"] },
    { id: "@cf/lykon/dreamshaper-8-lcm", name: "DreamShaper 8 LCM", type: "image", params: ["size"] },
    { id: "@cf/runwayml/stable-diffusion-v1-5-img2img", name: "Stable Diffusion v1.5 Img2Img", type: "image", params: ["size"], capabilities: ["edit"] },
    { id: "@cf/runwayml/stable-diffusion-v1-5-inpainting", name: "Stable Diffusion v1.5 Inpainting", type: "image", params: ["size"], capabilities: ["edit", "mask"] },
    { id: "@cf/stabilityai/stable-diffusion-xl-base-1.0", name: "SDXL Base 1.0", type: "image", params: ["size"] },
  ],
  byteplus: [
    { id: "seed-2-0-pro-260328", name: "Seed 2.0 Pro" },
    { id: "seed-2-0-code-preview-260328", name: "Seed 2.0 Code Preview" },
    { id: "seed-2-0-mini-260215", name: "Seed 2.0 Mini" },
    { id: "seed-2-0-lite-260228", name: "Seed 2.0 Lite" },
    { id: "kimi-k2-thinking-251104", name: "Kimi K2 Thinking" },
    { id: "glm-4-7-251222", name: "GLM 4.7" },
    { id: "gpt-oss-120b-250805", name: "GPT-OSS-120B" },
  ],
  deepseek: [
    { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek-v4-pro-max", name: "DeepSeek V4 Pro Max", upstreamModelId: "deepseek-v4-pro" },
    { id: "deepseek-v4-pro-none", name: "DeepSeek V4 Pro No Thinking", upstreamModelId: "deepseek-v4-pro" },
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "deepseek-chat", name: "DeepSeek V3.2 Chat" },
    { id: "deepseek-reasoner", name: "DeepSeek V3.2 Reasoner" },
  ],
  commandcode: [
    { id: "deepseek/deepseek-v4-pro", name: "DeepSeek V4 Pro" },
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "moonshotai/Kimi-K2.6", name: "Kimi K2.6" },
    { id: "moonshotai/Kimi-K2.5", name: "Kimi K2.5" },
    { id: "zai-org/GLM-5.1", name: "GLM 5.1" },
    { id: "zai-org/GLM-5", name: "GLM 5" },
    { id: "MiniMaxAI/MiniMax-M2.7", name: "MiniMax M2.7" },
    { id: "MiniMaxAI/MiniMax-M2.5", name: "MiniMax M2.5" },
    { id: "Qwen/Qwen3.6-Max-Preview", name: "Qwen 3.6 Max Preview" },
    { id: "Qwen/Qwen3.6-Plus", name: "Qwen 3.6 Plus" },
    { id: "stepfun/Step-3.5-Flash", name: "Step 3.5 Flash" },
  ],
  groq: [
    { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
    { id: "meta-llama/llama-4-maverick-17b-128e-instruct", name: "Llama 4 Maverick" },
    { id: "qwen/qwen3-32b", name: "Qwen3 32B" },
    { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B" },
    // STT models
    { id: "whisper-large-v3", name: "Whisper Large v3", type: "stt", params: ["language", "response_format", "temperature", "prompt"] },
    { id: "whisper-large-v3-turbo", name: "Whisper Large v3 Turbo", type: "stt", params: ["language", "response_format", "temperature", "prompt"] },
    { id: "distil-whisper-large-v3-en", name: "Distil Whisper Large v3 EN", type: "stt", params: ["language", "response_format", "temperature", "prompt"] },
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
    { id: "mistral-embed", name: "Mistral Embed", type: "embedding" },
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
    { id: "BAAI/bge-large-en-v1.5", name: "BGE Large EN v1.5", type: "embedding" },
    { id: "togethercomputer/m2-bert-80M-8k-retrieval", name: "M2 BERT 80M 8K", type: "embedding" },
  ],
  fireworks: [
    { id: "accounts/fireworks/models/deepseek-v3p1", name: "DeepSeek V3.1" },
    { id: "accounts/fireworks/models/llama-v3p3-70b-instruct", name: "Llama 3.3 70B" },
    { id: "accounts/fireworks/models/qwen3-235b-a22b", name: "Qwen3 235B" },
    { id: "nomic-ai/nomic-embed-text-v1.5", name: "Nomic Embed Text v1.5", type: "embedding" },
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
    { id: "minimaxai/minimax-m2.7", name: "Minimax M2.7" },
    { id: "z-ai/glm4.7", name: "GLM 4.7" },
    { id: "nvidia/nv-embedqa-e5-v5", name: "NV EmbedQA E5 v5", type: "embedding" },
    // STT models
    { id: "nvidia/parakeet-ctc-1.1b-asr", name: "Parakeet CTC 1.1B", type: "stt", params: ["language"] },
  ],
  nebius: [
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B Instruct" },
    { id: "Qwen/Qwen3-Embedding-8B", name: "Qwen3 Embedding 8B", type: "embedding" },
  ],
  "voyage-ai": [
    { id: "voyage-3-large", name: "Voyage 3 Large", type: "embedding" },
    { id: "voyage-3.5", name: "Voyage 3.5", type: "embedding" },
    { id: "voyage-3.5-lite", name: "Voyage 3.5 Lite", type: "embedding" },
    { id: "voyage-code-3", name: "Voyage Code 3", type: "embedding" },
    { id: "voyage-finance-2", name: "Voyage Finance 2", type: "embedding" },
    { id: "voyage-law-2", name: "Voyage Law 2", type: "embedding" },
    { id: "voyage-multilingual-2", name: "Voyage Multilingual 2", type: "embedding" },
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
  "xiaomi-mimo": [
    { id: "mimo-v2.5-pro", name: "MiMo V2.5 Pro" },
    { id: "mimo-v2.5", name: "MiMo V2.5" },
    { id: "mimo-v2-omni", name: "MiMo V2 Omni" },
    { id: "mimo-v2-flash", name: "MiMo V2 Flash" },
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
    { id: "nanobanana-flash", name: "NanoBanana Flash", type: "image", params: ["n", "size"] },
    { id: "nanobanana-pro", name: "NanoBanana Pro", type: "image", params: ["n", "size"] },
  ],
  sdwebui: [
    { id: "stable-diffusion-v1-5", name: "Stable Diffusion v1.5", type: "image", params: ["n", "size"] },
    { id: "sdxl-base-1.0", name: "SDXL Base 1.0", type: "image", params: ["n", "size"] },
  ],
  comfyui: [
    { id: "flux-dev", name: "FLUX Dev", type: "image", params: ["n", "size"] },
    { id: "sdxl", name: "SDXL", type: "image", params: ["n", "size"] },
  ],
  huggingface: [
    { id: "black-forest-labs/FLUX.1-schnell", name: "FLUX.1 Schnell", type: "image", params: [] },
    { id: "stabilityai/stable-diffusion-xl-base-1.0", name: "SDXL Base 1.0", type: "image", params: [] },
    // STT models
    { id: "openai/whisper-large-v3", name: "Whisper Large v3 (HF)", type: "stt", params: ["language"] },
    { id: "openai/whisper-small", name: "Whisper Small (HF)", type: "stt", params: ["language"] },
  ],

  // === Free-tier providers (synced from OmniRoute) ===
  agentrouter: [
    { id: "claude-opus-4-6", name: "Claude 4.6 Opus" },
    { id: "claude-haiku-4-5-20251001", name: "Claude 4.5 Haiku" },
    { id: "glm-5.1", name: "GLM 5.1" },
    { id: "deepseek-v3.2", name: "DeepSeek V3.2" },
  ],
  aimlapi: [
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet" },
    { id: "gemini-2.0-flash-exp", name: "Gemini 2.0 Flash" },
    { id: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo", name: "Llama 3.1 70B" },
  ],
  novita: [
    { id: "deepseek/deepseek-r1", name: "DeepSeek R1" },
    { id: "deepseek/deepseek-v3", name: "DeepSeek V3" },
    { id: "meta-llama/llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
    { id: "qwen/qwen-2.5-72b-instruct", name: "Qwen 2.5 72B" },
  ],
  modal: [
    { id: "auto", name: "Auto (User-hosted)" },
  ],
  reka: [
    { id: "reka-flash-3", name: "Reka Flash 3" },
    { id: "reka-edge-2603", name: "Reka Edge 2603" },
  ],
  nlpcloud: [
    { id: "chatdolphin", name: "ChatDolphin" },
    { id: "dolphin", name: "Dolphin" },
    { id: "finetuned-llama-3-70b", name: "Llama 3 70B (Finetuned)" },
  ],
  bazaarlink: [
    { id: "auto:free", name: "Auto Free (Zero Cost)" },
    { id: "auto", name: "Auto (Best Model)" },
  ],
  completions: [
    { id: "claude-opus-4", name: "Claude Opus 4" },
    { id: "claude-sonnet-4", name: "Claude Sonnet 4" },
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" },
  ],
  enally: [
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet" },
  ],
  freetheai: [
    { id: "gpt-4o", name: "GPT-4o" },
    { id: "claude-3-5-sonnet", name: "Claude 3.5 Sonnet" },
    { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro" },
    { id: "deepseek-chat", name: "DeepSeek Chat" },
  ],
  llm7: [
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
    { id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
    { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash" },
  ],
  lepton: [
    { id: "llama3-1-405b", name: "Llama 3.1 405B" },
    { id: "llama3-1-70b", name: "Llama 3.1 70B" },
    { id: "llama3-1-8b", name: "Llama 3.1 8B" },
    { id: "mixtral-8x7b", name: "Mixtral 8x7B" },
  ],
  kluster: [
    { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1" },
    { id: "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8", name: "Llama 4 Maverick" },
    { id: "meta-llama/Llama-4-Scout-17B-16E-Instruct", name: "Llama 4 Scout" },
    { id: "Qwen/Qwen3-235B-A22B-Instruct", name: "Qwen3 235B" },
  ],
  ai21: [
    { id: "jamba-large", name: "Jamba 1.5 Large" },
    { id: "jamba-mini", name: "Jamba 1.5 Mini" },
  ],
  "inference-net": [
    { id: "meta-llama/llama-3.3-70b-instruct/fp-16", name: "Llama 3.3 70B" },
    { id: "deepseek/deepseek-v3-0324", name: "DeepSeek V3" },
    { id: "mistralai/mistral-nemo-12b-instruct/fp-16", name: "Mistral Nemo 12B" },
  ],
  predibase: [
    { id: "llama-3-2-3b-instruct", name: "Llama 3.2 3B" },
    { id: "llama-3-1-8b-instruct", name: "Llama 3.1 8B" },
    { id: "qwen2-5-7b-instruct", name: "Qwen 2.5 7B" },
  ],
  bytez: [
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B" },
    { id: "mistralai/Mistral-7B-Instruct-v0.3", name: "Mistral 7B v0.3" },
    { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B" },
  ],
  morph: [
    { id: "morph-v3-large", name: "Morph V3 Large" },
    { id: "morph-v3-fast", name: "Morph V3 Fast" },
  ],
  longcat: [
    { id: "LongCat-Flash-Chat", name: "LongCat Flash Chat" },
    { id: "LongCat-Flash-Thinking", name: "LongCat Flash Thinking" },
    { id: "LongCat-Flash-Lite", name: "LongCat Flash Lite" },
  ],
  puter: [
    { id: "gpt-5", name: "GPT-5" },
    { id: "claude-opus-4", name: "Claude Opus 4" },
    { id: "gemini-3-pro-preview", name: "Gemini 3 Pro" },
    { id: "grok-4", name: "Grok 4" },
    { id: "deepseek-chat", name: "DeepSeek V3" },
  ],
  uncloseai: [
    { id: "auto", name: "Auto (Free)" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini" },
  ],
  scaleway: [
    { id: "qwen3-235b-a22b-instruct-2507", name: "Qwen3 235B" },
    { id: "llama-3.3-70b-instruct", name: "Llama 3.3 70B" },
    { id: "mistral-small-3.1-24b-instruct-2503", name: "Mistral Small 3.1" },
  ],
  deepinfra: [
    { id: "meta-llama/Meta-Llama-3.1-70B-Instruct", name: "Llama 3.1 70B" },
    { id: "deepseek-ai/DeepSeek-V3", name: "DeepSeek V3" },
    { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B" },
  ],
  sambanova: [
    { id: "Meta-Llama-3.1-405B-Instruct", name: "Llama 3.1 405B" },
    { id: "Meta-Llama-3.1-70B-Instruct", name: "Llama 3.1 70B" },
    { id: "Meta-Llama-3.1-8B-Instruct", name: "Llama 3.1 8B" },
  ],
  nscale: [
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B" },
    { id: "Qwen/Qwen2.5-Coder-32B-Instruct", name: "Qwen 2.5 Coder 32B" },
  ],
  baseten: [
    { id: "deepseek-ai/DeepSeek-R1", name: "DeepSeek R1" },
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B" },
  ],
  publicai: [
    { id: "auto", name: "Auto (Community)" },
  ],
  "nous-research": [
    { id: "Hermes-4-405B", name: "Hermes 4 405B" },
    { id: "Hermes-4-70B", name: "Hermes 4 70B" },
  ],
  glhf: [
    { id: "hf:meta-llama/Meta-Llama-3.1-405B-Instruct", name: "Llama 3.1 405B" },
    { id: "hf:meta-llama/Meta-Llama-3.1-70B-Instruct", name: "Llama 3.1 70B" },
    { id: "hf:Qwen/Qwen2.5-72B-Instruct", name: "Qwen 2.5 72B" },
  ],

  deepgram: [
    { id: "nova-3", name: "Nova 3", type: "stt", params: ["language"] },
    { id: "nova-2", name: "Nova 2", type: "stt", params: ["language"] },
    { id: "whisper-large", name: "Whisper Large", type: "stt", params: ["language"] },
  ],
  assemblyai: [
    { id: "universal-3-pro", name: "Universal 3 Pro", type: "stt", params: ["language"] },
    { id: "universal-2", name: "Universal 2", type: "stt", params: ["language"] },
  ],
  "fal-ai": [
    { id: "fal-ai/flux/schnell", name: "FLUX Schnell", type: "image", params: ["n", "size"] },
    { id: "fal-ai/flux/dev", name: "FLUX Dev", type: "image", params: ["n", "size"] },
    { id: "fal-ai/flux-pro/v1.1", name: "FLUX Pro v1.1", type: "image", params: ["n", "size"] },
    { id: "fal-ai/flux-pro/v1.1-ultra", name: "FLUX Pro v1.1 Ultra", type: "image", params: ["n", "size"] },
    { id: "fal-ai/recraft-v3", name: "Recraft V3", type: "image", params: ["n", "size", "style"] },
    { id: "fal-ai/ideogram/v2", name: "Ideogram V2", type: "image", params: ["n", "size", "style"] },
    { id: "fal-ai/stable-diffusion-v35-large", name: "SD 3.5 Large", type: "image", params: ["n", "size"] },
  ],
  "stability-ai": [
    { id: "stable-image-ultra", name: "Stable Image Ultra", type: "image", params: ["size"] },
    { id: "stable-image-core", name: "Stable Image Core", type: "image", params: ["size", "style"] },
    { id: "sd3.5-large", name: "Stable Diffusion 3.5 Large", type: "image", params: ["size"] },
    { id: "sd3.5-large-turbo", name: "Stable Diffusion 3.5 Large Turbo", type: "image", params: ["size"] },
    { id: "sd3.5-medium", name: "Stable Diffusion 3.5 Medium", type: "image", params: ["size"] },
  ],
  "black-forest-labs": [
    { id: "flux-pro-1.1", name: "FLUX Pro 1.1", type: "image", params: ["n", "size"] },
    { id: "flux-pro-1.1-ultra", name: "FLUX Pro 1.1 Ultra", type: "image", params: ["size"] },
    { id: "flux-pro", name: "FLUX Pro", type: "image", params: ["n", "size"] },
    { id: "flux-dev", name: "FLUX Dev", type: "image", params: ["n", "size"] },
    { id: "flux-kontext-pro", name: "FLUX Kontext Pro (Edit)", type: "image", params: ["size"], capabilities: ["edit"] },
    { id: "flux-kontext-max", name: "FLUX Kontext Max (Edit)", type: "image", params: ["size"], capabilities: ["edit"] },
  ],
  recraft: [
    { id: "recraftv3", name: "Recraft V3", type: "image", params: ["n", "size", "style"] },
    { id: "recraftv2", name: "Recraft V2", type: "image", params: ["n", "size", "style"] },
  ],
  runwayml: [
    { id: "gen4_image", name: "Gen-4 Image", type: "image", params: ["size"] },
    { id: "gen4_image_turbo", name: "Gen-4 Image Turbo", type: "image", params: ["size"] },
    { id: "gen4_turbo", name: "Gen-4 Turbo", type: "video", params: [] },
    { id: "gen3a_turbo", name: "Gen-3 Alpha Turbo", type: "video", params: [] },
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

export function getModelUpstreamId(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  const found = models?.find(m => m.id === modelId);
  if (found?.upstreamModelId) return found.upstreamModelId;
  if (aliasOrId === "cx" && typeof modelId === "string" && modelId.endsWith(CODEX_REVIEW_SUFFIX)) {
    return modelId.slice(0, -CODEX_REVIEW_SUFFIX.length);
  }
  return modelId;
}

export function getModelQuotaFamily(aliasOrId, modelId) {
  const models = PROVIDER_MODELS[aliasOrId];
  const found = models?.find(m => m.id === modelId);
  return found?.quotaFamily || "normal";
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
