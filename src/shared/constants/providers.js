// Provider definitions

// Free Providers (kiro first, iflow last)
export const FREE_PROVIDERS = {
  kiro: { id: "kiro", alias: "kr", name: "Kiro AI", icon: "psychology_alt", color: "#FF6B35", website: "https://kiro.dev", notice: { signupUrl: "https://kiro.dev" } },
  qwen: { id: "qwen", alias: "qw", name: "Qwen Code", icon: "psychology", color: "#10B981", mediaPriority: 999, deprecated: true, deprecationNotice: "Qwen OAuth free tier was discontinued by Alibaba on 2026-04-15. New connections will not work.", website: "https://chat.qwen.ai", notice: { signupUrl: "https://chat.qwen.ai" }, serviceKinds: ["llm", "tts"], ttsConfig: { baseUrl: "http://localhost:8000/v1/audio/speech", authType: "none", authHeader: "none", format: "openai", models: [{ id: "qwen3-tts", name: "Qwen3 TTS" }] } },
  "gemini-cli": { id: "gemini-cli", alias: "gc", name: "Gemini CLI", icon: "terminal", color: "#4285F4", deprecated: true, deprecationNotice: "Gemini CLI is designed exclusively for Gemini CLI. Using it with other tools (OpenClaw, Claude, Codex...) may result in account restrictions or bans.", website: "https://github.com/google-gemini/gemini-cli", notice: { signupUrl: "https://github.com/google-gemini/gemini-cli" } },
  // gitlab: { id: "gitlab", alias: "gl", name: "GitLab Duo", icon: "code", color: "#FC6D26" },
  // codebuddy: { id: "codebuddy", alias: "cb", name: "CodeBuddy", icon: "smart_toy", color: "#006EFF" },
  // qoder: { id: "qoder", alias: "qd", name: "Qoder AI", icon: "water_drop", color: "#EC4899" },
  iflow: { id: "iflow", alias: "if", name: "iFlow AI", icon: "water_drop", color: "#6366F1", website: "https://iflow.cn", notice: { signupUrl: "https://iflow.cn" } },
  opencode: { id: "opencode", alias: "oc", name: "OpenCode Free", icon: "terminal", color: "#E87040", textIcon: "OC", noAuth: true, passthroughModels: true, modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" } },
};

// Free Tier Providers (has free access but may require account/API key)
export const FREE_TIER_PROVIDERS = {
  openrouter: { id: "openrouter", alias: "openrouter", name: "OpenRouter", icon: "router", color: "#F97316", textIcon: "OR", website: "https://openrouter.ai", notice: { text: "Free tier: 27+ free models, no credit card needed, 200 req/day. After $10 credit: 1,000 req/day.", apiKeyUrl: "https://openrouter.ai/settings/keys" }, modelsFetcher: { url: "https://openrouter.ai/api/v1/models", type: "openrouter-free" }, passthroughModels: true, serviceKinds: ["llm", "embedding", "tts", "imageToText"], embeddingConfig: { baseUrl: "https://openrouter.ai/api/v1/embeddings", authType: "apikey", authHeader: "bearer", models: [{ id: "openai/text-embedding-3-small", name: "Text Embedding 3 Small (OpenRouter)", dimensions: 1536 }, { id: "openai/text-embedding-3-large", name: "Text Embedding 3 Large (OpenRouter)", dimensions: 3072 }, { id: "openai/text-embedding-ada-002", name: "Text Embedding Ada 002 (OpenRouter)", dimensions: 1536 }] } },
  nvidia: { id: "nvidia", alias: "nvidia", name: "NVIDIA NIM", icon: "developer_board", color: "#76B900", textIcon: "NV", website: "https://developer.nvidia.com/nim", notice: { text: "Free access for NVIDIA Developer Program members (prototyping & testing).", apiKeyUrl: "https://build.nvidia.com/settings/api-keys" }, serviceKinds: ["llm", "tts", "embedding"], ttsConfig: { baseUrl: "https://integrate.api.nvidia.com/v1/audio/speech", authType: "apikey", authHeader: "bearer", format: "nvidia-tts", models: [{ id: "fastpitch", name: "FastPitch" }, { id: "tacotron2", name: "Tacotron2" }] }, embeddingConfig: { baseUrl: "https://integrate.api.nvidia.com/v1/embeddings", authType: "apikey", authHeader: "bearer", models: [{ id: "nvidia/nv-embedqa-e5-v5", name: "NV EmbedQA E5 v5", dimensions: 1024 }] } },
  ollama: { id: "ollama", alias: "ollama", name: "Ollama Cloud", icon: "cloud", color: "#ffffffff", textIcon: "OL", website: "https://ollama.com", notice: { text: "Free tier: light usage, 1 cloud model at a time (limits reset every 5h & 7d). Pro $20/mo · Max $100/mo.", apiKeyUrl: "https://ollama.com/settings/keys" } },
  vertex: { id: "vertex", alias: "vx", name: "Vertex AI", icon: "cloud", color: "#4285F4", textIcon: "VX", website: "https://cloud.google.com/vertex-ai", notice: { text: "New Google Cloud accounts get $300 free credits. Requires GCP project + Service Account with Vertex AI API enabled.", apiKeyUrl: "https://console.cloud.google.com/iam-admin/serviceaccounts" } },
  gemini: { id: "gemini", alias: "gemini", name: "Gemini", icon: "diamond", color: "#4285F4", textIcon: "GE", mediaPriority: 1, website: "https://ai.google.dev", notice: { apiKeyUrl: "https://aistudio.google.com/app/apikey" }, serviceKinds: ["llm", "embedding", "image", "imageToText", "webSearch", "tts", "stt"], sttConfig: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/models", authType: "apikey", authHeader: "key", format: "gemini-stt", models: [{ id: "gemini-2.5-pro", name: "Gemini 2.5 Pro (Best)" }, { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash" }, { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite (Cheapest)" }, { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash" }] }, searchViaChat: { defaultModel: "gemini-2.5-flash", pricingUrl: "https://ai.google.dev/pricing", freeTier: "Free tier: 15 RPM, 1M tokens/day on gemini-2.5-flash via AI Studio." }, embeddingConfig: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/models", authType: "apikey", authHeader: "key", models: [{ id: "text-embedding-004", name: "Text Embedding 004", dimensions: 768 }, { id: "embedding-001", name: "Embedding 001", dimensions: 768 }] }, ttsConfig: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/models", authType: "apikey", authHeader: "key", format: "gemini-tts", models: [{ id: "gemini-2.5-flash-preview-tts", name: "Gemini 2.5 Flash TTS" }, { id: "gemini-2.5-pro-preview-tts", name: "Gemini 2.5 Pro TTS" }] } },
  "cloudflare-ai": { id: "cloudflare-ai", alias: "cf", name: "Cloudflare", icon: "cloud", color: "#F38020", textIcon: "CF", website: "https://developers.cloudflare.com/workers-ai/", notice: { text: "Workers AI free tier. Requires a Cloudflare API token and Account ID.", apiKeyUrl: "https://dash.cloudflare.com/profile/api-tokens" }, serviceKinds: ["llm", "image"], hasProviderSpecificData: true },
  byteplus: { id: "byteplus", alias: "bpm", name: "BytePlus ModelArk", icon: "cloud", color: "#2563EB", textIcon: "BP", website: "https://console.byteplus.com/ark", notice: { text: "Free credits for new accounts. Access to Seed 2.0, Kimi K2 Thinking, GLM 4.7, GPT-OSS-120B models.", apiKeyUrl: "https://console.byteplus.com/ark/region:ark+ap-southeast-1/apiKey" }, serviceKinds: ["llm"] },
};

// Thinking config definitions
// options: list of selectable modes ("auto" = no override from server)
// defaultMode: fallback when user hasn't configured
// extended: claude-style thinking (thinking.type + budget_tokens) — used by most providers
// effort: openai-style reasoning_effort — only openai + codex
export const THINKING_CONFIG = {
  extended: {
    options: ["auto", "on", "off"],
    defaultMode: "auto",
    defaultBudgetTokens: 10000
  },
  effort: {
    options: ["auto", "none", "low", "medium", "high"],
    defaultMode: "auto"
  }
};

// OAuth Providers
export const OAUTH_PROVIDERS = {
  claude: { id: "claude", alias: "cc", name: "Claude Code", icon: "smart_toy", color: "#D97757", website: "https://claude.ai", notice: { signupUrl: "https://claude.ai" } },
  antigravity: { id: "antigravity", alias: "ag", name: "Antigravity", icon: "rocket_launch", color: "#F59E0B", deprecated: true, deprecationNotice: "AG is designed exclusively for Antigravity IDE. Using it with other tools (OpenClaw, Claude, Codex...) may result in account restrictions or bans.", website: "https://antigravity.google", notice: { signupUrl: "https://antigravity.google" } },
  codex: { id: "codex", alias: "cx", name: "OpenAI Codex", icon: "code", color: "#3B82F6", thinkingConfig: THINKING_CONFIG.effort, serviceKinds: ["llm", "image"], kindNotice: { image: "Requires a ChatGPT Plus (or higher) account. Free accounts are not supported for image generation." }, website: "https://chatgpt.com/codex", notice: { signupUrl: "https://chatgpt.com/codex" } },
  github: { id: "github", alias: "gh", name: "GitHub Copilot", icon: "code", color: "#333333", serviceKinds: ["llm", "embedding"], embeddingConfig: { baseUrl: "https://models.github.ai/inference/embeddings", authType: "apikey", authHeader: "bearer", models: [{ id: "text-embedding-3-small", name: "Text Embedding 3 Small (GitHub)", dimensions: 1536 }, { id: "text-embedding-3-large", name: "Text Embedding 3 Large (GitHub)", dimensions: 3072 }] }, website: "https://github.com/features/copilot", notice: { signupUrl: "https://github.com/features/copilot" } },
  cursor: { id: "cursor", alias: "cu", name: "Cursor IDE", icon: "edit_note", color: "#00D4AA", website: "https://cursor.com", notice: { signupUrl: "https://cursor.com" } },
  // "kimi-coding": { id: "kimi-coding", alias: "kmc", name: "Kimi Coding", icon: "psychology", color: "#1E40AF", textIcon: "KC" },
  kilocode: { id: "kilocode", alias: "kc", name: "Kilo Code", icon: "code", color: "#FF6B35", textIcon: "KC", website: "https://kilocode.ai", notice: { signupUrl: "https://kilocode.ai" } },
  cline: { id: "cline", alias: "cl", name: "Cline", icon: "smart_toy", color: "#5B9BD5", textIcon: "CL", website: "https://cline.bot", notice: { signupUrl: "https://cline.bot" } },
  // opencode: { id: "opencode", alias: "oc", name: "OpenCode", icon: "terminal", color: "#E87040", textIcon: "OC" },
};

export const APIKEY_PROVIDERS = {
  glm: { id: "glm", alias: "glm", name: "GLM Coding", icon: "code", color: "#2563EB", textIcon: "GL", website: "https://open.bigmodel.cn", notice: { apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys" } },
  "glm-cn": { id: "glm-cn", alias: "glm-cn", name: "GLM (China)", icon: "code", color: "#DC2626", textIcon: "GC", website: "https://open.bigmodel.cn", notice: { apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys" } },
  kimi: { id: "kimi", alias: "kimi", name: "Kimi", icon: "psychology", color: "#1E3A8A", textIcon: "KM", website: "https://kimi.moonshot.cn", notice: { apiKeyUrl: "https://platform.moonshot.ai/console/api-keys" }, serviceKinds: ["llm", "webSearch"], searchViaChat: { defaultModel: "kimi-k2.5", pricingUrl: "https://platform.moonshot.ai/docs/pricing/chat" } },
  minimax: { id: "minimax", alias: "minimax", name: "Minimax Coding", icon: "memory", color: "#7C3AED", textIcon: "MM", website: "https://www.minimaxi.com", notice: { apiKeyUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key" }, serviceKinds: ["llm", "image", "imageToText", "webSearch"], searchViaChat: { defaultModel: "MiniMax-M2.7", pricingUrl: "https://www.minimaxi.com/document/price" } },
  "minimax-cn": { id: "minimax-cn", alias: "minimax-cn", name: "Minimax (China)", icon: "memory", color: "#DC2626", textIcon: "MC", website: "https://www.minimaxi.com", notice: { apiKeyUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key" } },
  alicode: { id: "alicode", alias: "alicode", name: "Alibaba", icon: "cloud", color: "#FF6A00", textIcon: "ALi", website: "https://bailian.console.aliyun.com", notice: { apiKeyUrl: "https://bailian.console.aliyun.com/?apiKey=1" } },
  "alicode-intl": { id: "alicode-intl", alias: "alicode-intl", name: "Alibaba Intl", icon: "cloud", color: "#FF6A00", textIcon: "ALi", website: "https://modelstudio.console.alibabacloud.com", notice: { apiKeyUrl: "https://modelstudio.console.alibabacloud.com/?apiKey=1" } },
  "xiaomi-mimo": { id: "xiaomi-mimo", alias: "mimo", name: "Xiaomi MiMo", icon: "smart_toy", color: "#FF6900", textIcon: "XM", website: "https://xiaomimimo.com", notice: { apiKeyUrl: "https://xiaomimimo.com" } },
  "volcengine-ark": { id: "volcengine-ark", alias: "ark", name: "Volcengine Ark", icon: "cloud", color: "#1677FF", textIcon: "ARK", website: "https://ark.cn-beijing.volces.com", notice: { apiKeyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey" } },
  openai: { id: "openai", alias: "openai", name: "OpenAI", icon: "auto_awesome", color: "#10A37F", textIcon: "OA", website: "https://platform.openai.com", notice: { apiKeyUrl: "https://platform.openai.com/api-keys" }, serviceKinds: ["llm", "embedding", "tts", "stt", "image", "imageToText", "webSearch"], thinkingConfig: THINKING_CONFIG.effort, searchViaChat: { defaultModel: "gpt-4o-mini", pricingUrl: "https://openai.com/api/pricing" }, ttsConfig: { baseUrl: "https://api.openai.com/v1/audio/speech", authType: "apikey", authHeader: "bearer", format: "openai", models: [{ id: "tts-1", name: "TTS-1" }, { id: "tts-1-hd", name: "TTS-1 HD" }, { id: "gpt-4o-mini-tts", name: "GPT-4o Mini TTS" }] }, sttConfig: { baseUrl: "https://api.openai.com/v1/audio/transcriptions", authType: "apikey", authHeader: "bearer", format: "openai", models: [{ id: "whisper-1", name: "Whisper 1" }, { id: "gpt-4o-transcribe", name: "GPT-4o Transcribe" }, { id: "gpt-4o-mini-transcribe", name: "GPT-4o Mini Transcribe" }] }, embeddingConfig: { baseUrl: "https://api.openai.com/v1/embeddings", authType: "apikey", authHeader: "bearer", models: [{ id: "text-embedding-3-small", name: "Text Embedding 3 Small", dimensions: 1536 }, { id: "text-embedding-3-large", name: "Text Embedding 3 Large", dimensions: 3072 }, { id: "text-embedding-ada-002", name: "Text Embedding Ada 002", dimensions: 1536 }] } },
  anthropic: { id: "anthropic", alias: "anthropic", name: "Anthropic", icon: "smart_toy", color: "#D97757", textIcon: "AN", website: "https://console.anthropic.com", notice: { apiKeyUrl: "https://console.anthropic.com/settings/keys" }, serviceKinds: ["llm", "imageToText"] },
  "opencode-go": { id: "opencode-go", alias: "ocg", name: "OpenCode Go", icon: "terminal", color: "#E87040", textIcon: "OC", website: "https://opencode.ai/auth", notice: { text: "OpenCode Go subscription: $5/mo (then $10/mo). Access to Kimi, GLM, Qwen, MiMo, MiniMax models.", apiKeyUrl: "https://opencode.ai/auth" } },
  azure: { id: "azure", alias: "azure", name: "Azure OpenAI", icon: "cloud", color: "#0078D4", textIcon: "AZ", website: "https://azure.microsoft.com/en-us/products/ai-services/openai-service", notice: { apiKeyUrl: "https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/OpenAI" }, hasProviderSpecificData: true },

  deepseek: { id: "deepseek", alias: "ds", name: "DeepSeek", icon: "bolt", color: "#4D6BFE", textIcon: "DS", website: "https://deepseek.com", notice: { apiKeyUrl: "https://platform.deepseek.com/api_keys" } },
  commandcode: { id: "commandcode", alias: "cmc", name: "Command Code", icon: "smart_toy", color: "#000000", textIcon: "CC", website: "https://commandcode.ai", notice: { text: "Use your CommandCode CLI API key (starts with user_...) from ~/.commandcode/auth.json or commandcode.ai/studio.", apiKeyUrl: "https://commandcode.ai/studio" } },
  groq: { id: "groq", alias: "groq", name: "Groq", icon: "speed", color: "#F55036", textIcon: "GQ", website: "https://groq.com", notice: { apiKeyUrl: "https://console.groq.com/keys" }, serviceKinds: ["llm", "imageToText", "stt"], sttConfig: { baseUrl: "https://api.groq.com/openai/v1/audio/transcriptions", authType: "apikey", authHeader: "bearer", format: "openai", models: [{ id: "whisper-large-v3", name: "Whisper Large v3" }, { id: "whisper-large-v3-turbo", name: "Whisper Large v3 Turbo" }, { id: "distil-whisper-large-v3-en", name: "Distil Whisper Large v3 EN" }] } },
  xai: { id: "xai", alias: "xai", name: "xAI (Grok)", icon: "auto_awesome", color: "#1DA1F2", textIcon: "XA", website: "https://x.ai", notice: { apiKeyUrl: "https://console.x.ai" }, serviceKinds: ["llm", "imageToText", "webSearch"], searchViaChat: { defaultModel: "grok-4.20-reasoning", pricingUrl: "https://x.ai/api#pricing" } },
  mistral: { id: "mistral", alias: "mistral", name: "Mistral", icon: "air", color: "#FF7000", textIcon: "MI", website: "https://mistral.ai", notice: { apiKeyUrl: "https://console.mistral.ai/api-keys" }, serviceKinds: ["llm", "imageToText", "embedding"], embeddingConfig: { baseUrl: "https://api.mistral.ai/v1/embeddings", authType: "apikey", authHeader: "bearer", models: [{ id: "mistral-embed", name: "Mistral Embed", dimensions: 1024 }] } },
  perplexity: { id: "perplexity", alias: "pplx", name: "Perplexity", icon: "search", color: "#20808D", textIcon: "PP", website: "https://www.perplexity.ai", notice: { apiKeyUrl: "https://www.perplexity.ai/settings/api" }, serviceKinds: ["llm", "webSearch"], searchConfig: { baseUrl: "https://api.perplexity.ai/search", method: "POST", authType: "apikey", authHeader: "bearer", costPerQuery: 0.005, freeMonthlyQuota: 0, searchTypes: ["web"], defaultMaxResults: 5, maxMaxResults: 20, timeoutMs: 10000, cacheTTLMs: 300000 } },
  together: { id: "together", alias: "together", name: "Together AI", icon: "group_work", color: "#0F6FFF", textIcon: "TG", website: "https://www.together.ai", notice: { apiKeyUrl: "https://api.together.xyz/settings/api-keys" }, serviceKinds: ["llm", "embedding"], embeddingConfig: { baseUrl: "https://api.together.xyz/v1/embeddings", authType: "apikey", authHeader: "bearer", models: [{ id: "BAAI/bge-large-en-v1.5", name: "BGE Large EN v1.5", dimensions: 1024 }, { id: "togethercomputer/m2-bert-80M-8k-retrieval", name: "M2 BERT 80M 8K", dimensions: 768 }] } },
  fireworks: { id: "fireworks", alias: "fireworks", name: "Fireworks AI", icon: "local_fire_department", color: "#7B2EF2", textIcon: "FW", website: "https://fireworks.ai", notice: { apiKeyUrl: "https://fireworks.ai/account/api-keys" }, serviceKinds: ["llm", "embedding"], embeddingConfig: { baseUrl: "https://api.fireworks.ai/inference/v1/embeddings", authType: "apikey", authHeader: "bearer", models: [{ id: "nomic-ai/nomic-embed-text-v1.5", name: "Nomic Embed Text v1.5", dimensions: 768 }] } },
  cerebras: { id: "cerebras", alias: "cerebras", name: "Cerebras", icon: "memory", color: "#FF4F00", textIcon: "CB", website: "https://www.cerebras.ai", notice: { apiKeyUrl: "https://cloud.cerebras.ai/platform" } },
  cohere: { id: "cohere", alias: "cohere", name: "Cohere", icon: "hub", color: "#39594D", textIcon: "CO", website: "https://cohere.com", notice: { apiKeyUrl: "https://dashboard.cohere.com/api-keys" } },
  nebius: { id: "nebius", alias: "nebius", name: "Nebius AI", icon: "cloud", color: "#6C5CE7", textIcon: "NB", website: "https://nebius.com", notice: { apiKeyUrl: "https://studio.nebius.com/settings/api-keys" }, serviceKinds: ["llm", "embedding"], embeddingConfig: { baseUrl: "https://api.tokenfactory.nebius.com/v1/embeddings", authType: "apikey", authHeader: "bearer", models: [{ id: "Qwen/Qwen3-Embedding-8B", name: "Qwen3 Embedding 8B", dimensions: 4096 }] } },
  siliconflow: { id: "siliconflow", alias: "siliconflow", name: "SiliconFlow", icon: "cloud_queue", color: "#5B6EF5", textIcon: "SF", website: "https://cloud.siliconflow.com", notice: { apiKeyUrl: "https://cloud.siliconflow.com/account/ak" } },
  hyperbolic: { id: "hyperbolic", alias: "hyp", name: "Hyperbolic", icon: "bolt", color: "#00D4FF", textIcon: "HY", website: "https://hyperbolic.xyz", notice: { apiKeyUrl: "https://app.hyperbolic.xyz/settings" }, serviceKinds: ["llm", "tts"], ttsConfig: { baseUrl: "https://api.hyperbolic.xyz/v1/audio/generation", authType: "apikey", authHeader: "bearer", format: "hyperbolic", models: [{ id: "melo-tts", name: "Melo TTS" }] } },
  deepgram: { id: "deepgram", alias: "dg", name: "Deepgram", icon: "mic", color: "#13EF93", textIcon: "DG", website: "https://deepgram.com", notice: { text: "$200 free credit on signup (no card required). Aura-1: $0.015/1k chars, Aura-2: $0.030/1k chars (Pay-As-You-Go).", apiKeyUrl: "https://console.deepgram.com/api-keys" }, serviceKinds: ["stt", "imageToText", "tts"], ttsConfig: { baseUrl: "https://api.deepgram.com/v1/speak", authType: "apikey", authHeader: "token", format: "deepgram", models: [] }, sttConfig: { baseUrl: "https://api.deepgram.com/v1/listen", authType: "apikey", authHeader: "token", format: "deepgram", models: [{ id: "nova-3", name: "Nova 3" }, { id: "nova-2", name: "Nova 2" }, { id: "whisper-large", name: "Whisper Large" }] } },
  assemblyai: { id: "assemblyai", alias: "aai", name: "AssemblyAI", icon: "record_voice_over", color: "#0062FF", textIcon: "AA", website: "https://assemblyai.com", notice: { apiKeyUrl: "https://www.assemblyai.com/app/api-keys" }, serviceKinds: ["stt"], sttConfig: { baseUrl: "https://api.assemblyai.com/v2/transcript", authType: "apikey", authHeader: "bearer", format: "assemblyai", async: true, models: [{ id: "universal-3-pro", name: "Universal 3 Pro" }, { id: "universal-2", name: "Universal 2" }] } },
  nanobanana: { id: "nanobanana", alias: "nb", name: "NanoBanana API", icon: "extension", color: "#FFD700", textIcon: "🍌", website: "https://nanobananaapi.ai", notice: { text: "3rd-party proxy for Google Nano Banana (Gemini 2.5/3 Flash Image). For official, use Gemini provider.", apiKeyUrl: "https://nanobananaapi.ai/dashboard" }, serviceKinds: ["image"] },
  elevenlabs: { id: "elevenlabs", alias: "el", name: "ElevenLabs", icon: "record_voice_over", color: "#6C47FF", textIcon: "EL", website: "https://elevenlabs.io", notice: { apiKeyUrl: "https://elevenlabs.io/app/settings/api-keys" }, serviceKinds: ["tts"], ttsConfig: { baseUrl: "https://api.elevenlabs.io/v1/text-to-speech", authType: "apikey", authHeader: "xi-api-key", format: "elevenlabs", models: [{ id: "eleven_multilingual_v2", name: "Eleven Multilingual v2" }, { id: "eleven_turbo_v2_5", name: "Eleven Turbo v2.5" }] } },
  cartesia: { id: "cartesia", alias: "cartesia", name: "Cartesia", icon: "spatial_audio", color: "#FF4F8B", textIcon: "CA", website: "https://cartesia.ai", notice: { apiKeyUrl: "https://play.cartesia.ai/keys" }, serviceKinds: ["tts"], hidden: true, ttsConfig: { baseUrl: "https://api.cartesia.ai/tts/bytes", authType: "apikey", authHeader: "x-api-key", format: "cartesia", models: [{ id: "sonic-2", name: "Sonic 2" }, { id: "sonic-3", name: "Sonic 3" }] } },
  playht: { id: "playht", alias: "playht", name: "PlayHT", icon: "play_circle", color: "#00B4D8", textIcon: "PH", website: "https://play.ht", notice: { apiKeyUrl: "https://play.ht/studio/api-access" }, serviceKinds: ["tts"], hidden: true, ttsConfig: { baseUrl: "https://api.play.ht/api/v2/tts/stream", authType: "apikey", authHeader: "playht", format: "playht", models: [{ id: "PlayDialog", name: "PlayDialog" }, { id: "Play3.0-mini", name: "Play 3.0 Mini" }] } },
  "local-device": { id: "local-device", alias: "local-device", name: "Local Device", icon: "speaker", color: "#64748B", textIcon: "LD", mediaPriority: 5, serviceKinds: ["tts"], noAuth: true, ttsConfig: { baseUrl: "local-device", authType: "none", authHeader: "none", format: "local-device", models: [] } },
  "google-tts": { id: "google-tts", alias: "google-tts", name: "Google TTS", icon: "record_voice_over", color: "#4285F4", textIcon: "GT", mediaPriority: 5, serviceKinds: ["tts"], noAuth: true, ttsConfig: { baseUrl: "google-tts", authType: "none", authHeader: "none", format: "google-tts", models: [] } },
  "edge-tts": { id: "edge-tts", alias: "edge-tts", name: "Edge TTS", icon: "record_voice_over", color: "#0078D4", textIcon: "ET", mediaPriority: 5, serviceKinds: ["tts"], noAuth: true, ttsConfig: { baseUrl: "edge-tts", authType: "none", authHeader: "none", format: "edge-tts", models: [] } },
  coqui: { id: "coqui", alias: "coqui", name: "Coqui TTS", icon: "record_voice_over", color: "#10B981", textIcon: "CQ", website: "https://github.com/coqui-ai/TTS", serviceKinds: ["tts"], hidden: true, noAuth: true, ttsConfig: { baseUrl: "http://localhost:5002/api/tts", authType: "none", authHeader: "none", format: "coqui", models: [{ id: "tts_models/en/ljspeech/tacotron2-DDC", name: "Tacotron2 DDC (LJSpeech)" }] } },
  tortoise: { id: "tortoise", alias: "tortoise", name: "Tortoise TTS", icon: "record_voice_over", color: "#7C3AED", textIcon: "TT", website: "https://github.com/neonbjb/tortoise-tts", serviceKinds: ["tts"], hidden: true, noAuth: true, ttsConfig: { baseUrl: "http://localhost:5000/api/tts", authType: "none", authHeader: "none", format: "tortoise", models: [{ id: "tortoise-v2", name: "Tortoise v2" }] } },
  inworld: { id: "inworld", alias: "inworld", name: "Inworld TTS", icon: "record_voice_over", color: "#FF6B6B", textIcon: "IW", website: "https://inworld.ai", notice: { text: "Free tier: 40 minutes/month TTS. Paid: TTS-1.5 Mini $0.01/min ($15/1M chars), TTS-1.5 Max $0.025/min ($30/1M chars). 270+ voices, 15 languages.", apiKeyUrl: "https://platform.inworld.ai/api-keys" }, serviceKinds: ["tts"], ttsConfig: { baseUrl: "https://api.inworld.ai/tts/v1/voice", authType: "apikey", authHeader: "basic", format: "inworld", models: [{ id: "inworld-tts-1.5-mini", name: "Inworld TTS 1.5 Mini ($0.01/min)" }, { id: "inworld-tts-1.5-max", name: "Inworld TTS 1.5 Max ($0.025/min)" }] } },
  "voyage-ai": { id: "voyage-ai", alias: "voyage", name: "Voyage AI", icon: "data_array", color: "#0EA5E9", textIcon: "VG", website: "https://www.voyageai.com", notice: { apiKeyUrl: "https://dash.voyageai.com/api-keys" }, serviceKinds: ["embedding"], embeddingConfig: { baseUrl: "https://api.voyageai.com/v1/embeddings", authType: "apikey", authHeader: "bearer", models: [{ id: "voyage-3-large", name: "Voyage 3 Large", dimensions: 1024 }, { id: "voyage-3.5", name: "Voyage 3.5", dimensions: 1024 }, { id: "voyage-3.5-lite", name: "Voyage 3.5 Lite", dimensions: 1024 }, { id: "voyage-code-3", name: "Voyage Code 3", dimensions: 1024 }, { id: "voyage-finance-2", name: "Voyage Finance 2", dimensions: 1024 }, { id: "voyage-law-2", name: "Voyage Law 2", dimensions: 1024 }, { id: "voyage-multilingual-2", name: "Voyage Multilingual 2", dimensions: 1024 }] } },
  sdwebui: { id: "sdwebui", alias: "sdwebui", name: "SD WebUI", icon: "brush", color: "#FF7043", textIcon: "SD", website: "https://github.com/AUTOMATIC1111/stable-diffusion-webui", serviceKinds: ["image"] },
  comfyui: { id: "comfyui", alias: "comfyui", name: "ComfyUI", icon: "account_tree", color: "#4CAF50", textIcon: "CF", website: "https://github.com/comfyanonymous/ComfyUI", serviceKinds: ["image"] },
  huggingface: { id: "huggingface", alias: "hf", name: "HuggingFace", icon: "face", color: "#FFD21E", textIcon: "HF", website: "https://huggingface.co", notice: { apiKeyUrl: "https://huggingface.co/settings/tokens" }, serviceKinds: ["image", "imageToText", "tts", "stt"], hiddenKinds: ["tts"], ttsConfig: { baseUrl: "https://api-inference.huggingface.co/models", authType: "apikey", authHeader: "bearer", format: "huggingface-tts", models: [{ id: "facebook/mms-tts-eng", name: "MMS TTS English" }, { id: "microsoft/speecht5_tts", name: "SpeechT5 TTS" }] }, sttConfig: { baseUrl: "https://api-inference.huggingface.co/models", authType: "apikey", authHeader: "bearer", format: "huggingface-asr", models: [{ id: "openai/whisper-large-v3", name: "Whisper Large v3 (HF)" }, { id: "openai/whisper-small", name: "Whisper Small (HF)" }] } },
  blackbox: { id: "blackbox", alias: "bb", name: "Blackbox AI", icon: "smart_toy", color: "#5B5FEF", textIcon: "BB", website: "https://blackbox.ai", notice: { apiKeyUrl: "https://www.blackbox.ai/api-management" }, serviceKinds: ["llm"] },
  chutes: { id: "chutes", alias: "ch", name: "Chutes AI", icon: "water_drop", color: "#ffffffff", textIcon: "CH", website: "https://chutes.ai", notice: { apiKeyUrl: "https://chutes.ai/app/api" } },
  "ollama-local": { id: "ollama-local", alias: "ollama-local", name: "Ollama Local", icon: "cloud", color: "#ffffffff", textIcon: "OL", website: "https://ollama.com" },
  "vertex-partner": { id: "vertex-partner", alias: "vxp", name: "Vertex Partner", icon: "cloud", color: "#34A853", textIcon: "VP", website: "https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-partner-models", notice: { apiKeyUrl: "https://console.cloud.google.com/iam-admin/serviceaccounts" } },
  tavily: { id: "tavily", alias: "tavily", name: "Tavily", icon: "search", color: "#5B21B6", textIcon: "TV", website: "https://tavily.com", notice: { apiKeyUrl: "https://app.tavily.com/home" }, serviceKinds: ["webSearch", "webFetch"], searchConfig: { baseUrl: "https://api.tavily.com/search", method: "POST", authType: "apikey", authHeader: "bearer", costPerQuery: 0.008, freeMonthlyQuota: 1000, searchTypes: ["web", "news"], defaultMaxResults: 5, maxMaxResults: 20, timeoutMs: 10000, cacheTTLMs: 300000 }, fetchConfig: { baseUrl: "https://api.tavily.com/extract", method: "POST", authType: "apikey", authHeader: "bearer", costPerQuery: 0.008, freeMonthlyQuota: 1000, formats: ["markdown", "text"], maxCharacters: 100000, timeoutMs: 15000 } },
  "brave-search": { id: "brave-search", alias: "brave", name: "Brave Search", icon: "travel_explore", color: "#FB542B", textIcon: "BR", website: "https://brave.com/search/api", notice: { apiKeyUrl: "https://api-dashboard.search.brave.com/app/keys" }, serviceKinds: ["webSearch"], searchConfig: { baseUrl: "https://api.search.brave.com/res/v1", method: "GET", authType: "apikey", authHeader: "x-subscription-token", costPerQuery: 0.005, freeMonthlyQuota: 1000, searchTypes: ["web", "news"], defaultMaxResults: 5, maxMaxResults: 20, timeoutMs: 10000, cacheTTLMs: 300000 } },
  serper: { id: "serper", alias: "serper", name: "Serper", icon: "search", color: "#4F46E5", textIcon: "SP", website: "https://serper.dev", notice: { apiKeyUrl: "https://serper.dev/api-key" }, serviceKinds: ["webSearch"], searchConfig: { baseUrl: "https://google.serper.dev", method: "POST", authType: "apikey", authHeader: "x-api-key", costPerQuery: 0.001, freeMonthlyQuota: 2500, searchTypes: ["web", "news"], defaultMaxResults: 5, maxMaxResults: 100, timeoutMs: 10000, cacheTTLMs: 300000 } },
  exa: { id: "exa", alias: "exa", name: "Exa", icon: "manage_search", color: "#2563EB", textIcon: "EX", website: "https://exa.ai", notice: { apiKeyUrl: "https://dashboard.exa.ai/api-keys" }, serviceKinds: ["webSearch", "webFetch"], searchConfig: { baseUrl: "https://api.exa.ai/search", method: "POST", authType: "apikey", authHeader: "x-api-key", costPerQuery: 0.007, freeMonthlyQuota: 1000, searchTypes: ["web", "news"], defaultMaxResults: 5, maxMaxResults: 100, timeoutMs: 10000, cacheTTLMs: 300000 }, fetchConfig: { baseUrl: "https://api.exa.ai/contents", method: "POST", authType: "apikey", authHeader: "x-api-key", costPerQuery: 0.001, freeMonthlyQuota: 1000, formats: ["text", "markdown"], maxCharacters: 100000, timeoutMs: 15000 } },
  searxng: { id: "searxng", alias: "searxng", name: "SearXNG", icon: "saved_search", color: "#3B82F6", textIcon: "SX", website: "https://docs.searxng.org", serviceKinds: ["webSearch"], noAuth: true, searchConfig: { baseUrl: "http://localhost:8888/search", method: "GET", authType: "none", authHeader: "none", costPerQuery: 0, freeMonthlyQuota: 999999, searchTypes: ["web", "news"], defaultMaxResults: 5, maxMaxResults: 50, timeoutMs: 10000, cacheTTLMs: 180000 } },
  "google-pse": { id: "google-pse", alias: "gpse", name: "Google PSE", icon: "search", color: "#4285F4", textIcon: "GP", website: "https://programmablesearchengine.google.com", notice: { apiKeyUrl: "https://programmablesearchengine.google.com/controlpanel/create" }, serviceKinds: ["webSearch"], searchConfig: { baseUrl: "https://www.googleapis.com/customsearch/v1", method: "GET", authType: "apikey", authHeader: "key", costPerQuery: 0.005, freeMonthlyQuota: 3000, searchTypes: ["web", "news"], defaultMaxResults: 5, maxMaxResults: 10, timeoutMs: 10000, cacheTTLMs: 300000 } },
  linkup: { id: "linkup", alias: "linkup", name: "Linkup", icon: "link", color: "#0EA5E9", textIcon: "LK", website: "https://linkup.so", notice: { apiKeyUrl: "https://app.linkup.so/api-keys" }, serviceKinds: ["webSearch"], searchConfig: { baseUrl: "https://api.linkup.so/v1/search", method: "POST", authType: "apikey", authHeader: "bearer", costPerQuery: 0.005, freeMonthlyQuota: 1000, searchTypes: ["web"], defaultMaxResults: 5, maxMaxResults: 50, timeoutMs: 10000, cacheTTLMs: 300000 } },
  searchapi: { id: "searchapi", alias: "searchapi", name: "SearchAPI", icon: "search", color: "#0EA5A4", textIcon: "SA", website: "https://www.searchapi.io", notice: { apiKeyUrl: "https://www.searchapi.io/dashboard" }, serviceKinds: ["webSearch"], searchConfig: { baseUrl: "https://www.searchapi.io/api/v1/search", method: "GET", authType: "apikey", authHeader: "api_key", costPerQuery: 0.004, freeMonthlyQuota: 100, searchTypes: ["web", "news"], defaultMaxResults: 5, maxMaxResults: 100, timeoutMs: 10000, cacheTTLMs: 300000 } },
  youcom: { id: "youcom", alias: "youcom", name: "You.com Search", icon: "search", color: "#7C3AED", textIcon: "YC", website: "https://you.com", notice: { apiKeyUrl: "https://api.you.com" }, serviceKinds: ["webSearch"], searchConfig: { baseUrl: "https://ydc-index.io/v1/search", method: "GET", authType: "apikey", authHeader: "x-api-key", costPerQuery: 0.005, freeMonthlyQuota: 0, searchTypes: ["web", "news"], defaultMaxResults: 5, maxMaxResults: 100, timeoutMs: 10000, cacheTTLMs: 300000 } },
  firecrawl: { id: "firecrawl", alias: "firecrawl", name: "Firecrawl", icon: "local_fire_department", color: "#F59E0B", textIcon: "FC", website: "https://firecrawl.dev", notice: { apiKeyUrl: "https://www.firecrawl.dev/app/api-keys" }, serviceKinds: ["webFetch"], fetchConfig: { baseUrl: "https://api.firecrawl.dev/v1/scrape", method: "POST", authType: "apikey", authHeader: "bearer", costPerQuery: 0.002, freeMonthlyQuota: 500, formats: ["markdown", "html", "text"], maxCharacters: 200000, timeoutMs: 30000 } },
  "fal-ai": { id: "fal-ai", alias: "fal", name: "Fal.ai", icon: "image", color: "#2563EB", textIcon: "FL", website: "https://fal.ai", notice: { apiKeyUrl: "https://fal.ai/dashboard/keys" }, serviceKinds: ["image"], imageConfig: { baseUrl: "https://api.fal.ai/v1/models?limit=1", method: "GET", authType: "apikey", authHeader: "key" } },
  "stability-ai": { id: "stability-ai", alias: "stability", name: "Stability AI", icon: "image", color: "#8B5CF6", textIcon: "SA", website: "https://stability.ai", notice: { apiKeyUrl: "https://platform.stability.ai/account/keys" }, serviceKinds: ["image"], imageConfig: { baseUrl: "https://api.stability.ai/v1/user/account", method: "GET", authType: "apikey", authHeader: "bearer" } },
  "black-forest-labs": { id: "black-forest-labs", alias: "bfl", name: "Black Forest Labs", icon: "image", color: "#111827", textIcon: "BF", website: "https://blackforestlabs.ai", notice: { apiKeyUrl: "https://api.bfl.ai" }, serviceKinds: ["image"], imageConfig: { baseUrl: "https://api.bfl.ai/v1/get_result?id=ping", method: "GET", authType: "apikey", authHeader: "x-key" } },
  recraft: { id: "recraft", alias: "recraft", name: "Recraft", icon: "image", color: "#EC4899", textIcon: "RC", website: "https://recraft.ai", notice: { apiKeyUrl: "https://www.recraft.ai/profile/api" }, serviceKinds: ["image"], imageConfig: { baseUrl: "https://external.api.recraft.ai/v1/users/me", method: "GET", authType: "apikey", authHeader: "bearer" } },
  topaz: { id: "topaz", alias: "topaz", name: "Topaz", icon: "image", color: "#059669", textIcon: "TP", website: "https://topazlabs.com", notice: { apiKeyUrl: "https://topazlabs.com/account" }, serviceKinds: ["image"] },
  runwayml: { id: "runwayml", alias: "runway", name: "Runway ML", icon: "movie", color: "#000000", textIcon: "RW", website: "https://runwayml.com", notice: { apiKeyUrl: "https://dev.runwayml.com" }, serviceKinds: ["image", "video"], imageConfig: { baseUrl: "https://api.dev.runwayml.com/v1/organization", method: "GET", authType: "apikey", authHeader: "bearer", extraHeaders: { "X-Runway-Version": "2024-11-06" } } },
  "aws-polly": { id: "aws-polly", alias: "polly", name: "AWS Polly", icon: "record_voice_over", color: "#FF9900", textIcon: "PL", website: "https://aws.amazon.com/polly/", notice: { text: "Use AWS Secret Access Key as API key; set providerSpecificData.accessKeyId and optional region.", apiKeyUrl: "https://console.aws.amazon.com/iam/home#/security_credentials" }, serviceKinds: ["tts"], hasProviderSpecificData: true, ttsConfig: { baseUrl: "https://polly.{region}.amazonaws.com/v1/speech", authType: "apikey", authHeader: "aws-sigv4", format: "aws-polly", models: [{ id: "standard", name: "Standard" }, { id: "neural", name: "Neural" }, { id: "long-form", name: "Long-form" }, { id: "generative", name: "Generative" }] } },
  "jina-ai": { id: "jina-ai", alias: "jina", name: "Jina AI", icon: "blur_on", color: "#2563EB", textIcon: "JA", website: "https://jina.ai", notice: { text: "10M free tokens on signup (non-commercial), no credit card required.", apiKeyUrl: "https://jina.ai/?sui=apikey" }, serviceKinds: ["embedding"], embeddingConfig: { baseUrl: "https://api.jina.ai/v1/embeddings", authType: "apikey", authHeader: "bearer", models: [{ id: "jina-embeddings-v3", name: "Jina Embeddings v3", dimensions: 1024 }, { id: "jina-embeddings-v2-base-en", name: "Jina Embeddings v2 Base EN", dimensions: 768 }, { id: "jina-embeddings-v2-base-code", name: "Jina Embeddings v2 Base Code", dimensions: 768 }] } },
  "jina-reader": { id: "jina-reader", alias: "jina", name: "Jina Reader", icon: "menu_book", color: "#000000", textIcon: "JR", website: "https://jina.ai/reader", notice: { apiKeyUrl: "https://jina.ai/?sui=apikey" }, serviceKinds: ["webFetch"], fetchConfig: { baseUrl: "https://r.jina.ai", method: "GET", authType: "apikey", authHeader: "bearer", costPerQuery: 0, freeMonthlyQuota: 1000000, formats: ["markdown", "text", "html"], maxCharacters: 200000, timeoutMs: 30000 } },
};

// Web Cookie Providers (use browser session cookie instead of API key)
export const WEB_COOKIE_PROVIDERS = {
  "grok-web": { id: "grok-web", alias: "gw", name: "Grok Web (Subscription)", icon: "auto_awesome", color: "#1DA1F2", textIcon: "GW", website: "https://grok.com", authType: "cookie", authHint: "Paste your sso= cookie value from grok.com", passthroughModels: true, serviceKinds: ["llm"] },
  "perplexity-web": { id: "perplexity-web", alias: "pw", name: "Perplexity Web (Pro/Max)", icon: "search", color: "#20808D", textIcon: "PW", website: "https://www.perplexity.ai", authType: "cookie", authHint: "Paste your __Secure-next-auth.session-token cookie value from perplexity.ai", serviceKinds: ["llm"] },
};

// Media provider kinds — each kind maps to a route and endpoint config
export const MEDIA_PROVIDER_KINDS = [
  { id: "embedding",   label: "Embedding",      icon: "data_array",        endpoint: { method: "POST", path: "/v1/embeddings" } },
  { id: "image",       label: "Text to Image",  icon: "brush",             endpoint: { method: "POST", path: "/v1/images/generations" } },
  { id: "imageToText", label: "Image to Text",  icon: "image_search",      endpoint: { method: "POST", path: "/v1/images/understanding" } },
  { id: "tts",         label: "Text To Speech", icon: "record_voice_over", endpoint: { method: "POST", path: "/v1/audio/speech" } },
  { id: "stt",         label: "Speech To Text", icon: "mic",               endpoint: { method: "POST", path: "/v1/audio/transcriptions" } },
  { id: "webSearch",   label: "Web Search",     icon: "travel_explore",    endpoint: { method: "POST", path: "/v1/search" } },
  { id: "webFetch",    label: "Web Fetch",      icon: "language",          endpoint: { method: "POST", path: "/v1/web/fetch" } },
  { id: "video",       label: "Video",          icon: "movie",             endpoint: { method: "POST", path: "/v1/video/generations" } },
  { id: "music",       label: "Music",          icon: "music_note",        endpoint: { method: "POST", path: "/v1/audio/music" } },
];

export const OPENAI_COMPATIBLE_PREFIX = "openai-compatible-";
export const ANTHROPIC_COMPATIBLE_PREFIX = "anthropic-compatible-";
export const CUSTOM_EMBEDDING_PREFIX = "custom-embedding-";

export function isOpenAICompatibleProvider(providerId) {
  return typeof providerId === "string" && providerId.startsWith(OPENAI_COMPATIBLE_PREFIX);
}

export function isAnthropicCompatibleProvider(providerId) {
  return typeof providerId === "string" && providerId.startsWith(ANTHROPIC_COMPATIBLE_PREFIX);
}

export function isCustomEmbeddingProvider(providerId) {
  return typeof providerId === "string" && providerId.startsWith(CUSTOM_EMBEDDING_PREFIX);
}

// All providers (combined)
export const AI_PROVIDERS = { ...FREE_PROVIDERS, ...FREE_TIER_PROVIDERS, ...OAUTH_PROVIDERS, ...APIKEY_PROVIDERS, ...WEB_COOKIE_PROVIDERS };

// Auth methods
export const AUTH_METHODS = {
  oauth: { id: "oauth", name: "OAuth", icon: "lock" },
  apikey: { id: "apikey", name: "API Key", icon: "key" },
  cookie: { id: "cookie", name: "Browser Cookie", icon: "cookie" },
};

// Helper: Get provider by alias
export function getProviderByAlias(alias) {
  for (const provider of Object.values(AI_PROVIDERS)) {
    if (provider.alias === alias || provider.id === alias) {
      return provider;
    }
  }
  return null;
}

// Helper: Get provider ID from alias
export function resolveProviderId(aliasOrId) {
  const provider = getProviderByAlias(aliasOrId);
  return provider?.id || aliasOrId;
}

// Helper: Get alias from provider ID
export function getProviderAlias(providerId) {
  const provider = AI_PROVIDERS[providerId];
  return provider?.alias || providerId;
}

// Alias to ID mapping (for quick lookup)
export const ALIAS_TO_ID = Object.values(AI_PROVIDERS).reduce((acc, p) => {
  acc[p.alias] = p.id;
  return acc;
}, {});

// ID to Alias mapping
export const ID_TO_ALIAS = Object.values(AI_PROVIDERS).reduce((acc, p) => {
  acc[p.id] = p.alias;
  return acc;
}, {});

// Helper: Get providers by service kind (e.g. "tts", "embedding", "image")
// Providers without serviceKinds default to ["llm"]
export function getProvidersByKind(kind) {
  return Object.values(AI_PROVIDERS)
    .filter((p) => {
      const kinds = p.serviceKinds ?? ["llm"];
      if (!kinds.includes(kind)) return false;
      if (p.hidden) return false;
      if (p.hiddenKinds?.includes(kind)) return false;
      return true;
    })
    .sort((a, b) => (a.mediaPriority ?? 100) - (b.mediaPriority ?? 100));
}

// Providers that support usage/quota API
export const USAGE_SUPPORTED_PROVIDERS = [
  "claude",
  "antigravity",
  "kiro",
  "github",
  "codex",
  "kimi-coding",
  "ollama",
  "gemini-cli",
  "glm",
  "glm-cn",
  "minimax",
  "minimax-cn",
];

// Subset that uses apikey auth (still surfaced on quota page)
export const USAGE_APIKEY_PROVIDERS = [
  "glm",
  "glm-cn",
  "minimax",
  "minimax-cn",
];
