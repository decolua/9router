// Provider definitions

// Free Providers (kiro first, iflow last)
export const FREE_PROVIDERS = {
  kiro: { id: "kiro", alias: "kr", name: "Kiro AI", icon: "psychology_alt", color: "#FF6B35" },
  qwen: { id: "qwen", alias: "qw", name: "Qwen Code", icon: "psychology", color: "#10B981", deprecated: true, deprecationNotice: "Qwen OAuth free tier was discontinued by Alibaba on 2026-04-15. New connections will not work." },
  "gemini-cli": { id: "gemini-cli", alias: "gc", name: "Gemini CLI", icon: "terminal", color: "#4285F4", deprecated: true, deprecationNotice: "Gemini CLI is designed exclusively for Gemini CLI. Using it with other tools (OpenClaw, Claude, Codex...) may result in account restrictions or bans." },
  // gitlab: { id: "gitlab", alias: "gl", name: "GitLab Duo", icon: "code", color: "#FC6D26" },
  // codebuddy: { id: "codebuddy", alias: "cb", name: "CodeBuddy", icon: "smart_toy", color: "#006EFF" },
  // qoder: { id: "qoder", alias: "qd", name: "Qoder AI", icon: "water_drop", color: "#EC4899" },
  iflow: { id: "iflow", alias: "if", name: "iFlow AI", icon: "water_drop", color: "#6366F1" },
  opencode: { id: "opencode", alias: "oc", name: "OpenCode Free", icon: "terminal", color: "#E87040", textIcon: "OC", noAuth: true, passthroughModels: true, modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" } },
};

// Free Tier Providers (has free access but may require account/API key)
export const FREE_TIER_PROVIDERS = {
  openrouter: { id: "openrouter", alias: "openrouter", name: "OpenRouter", icon: "router", color: "#F97316", textIcon: "OR", website: "https://openrouter.ai", notice: { text: "Free tier: 27+ free models, no credit card needed, 200 req/day. After $10 credit: 1,000 req/day.", apiKeyUrl: "https://openrouter.ai/settings/keys" }, modelsFetcher: { url: "https://openrouter.ai/api/v1/models", type: "openrouter-free" }, passthroughModels: true, serviceKinds: ["llm", "embedding", "tts", "imageToText"] },
  nvidia: { id: "nvidia", alias: "nvidia", name: "NVIDIA NIM", icon: "developer_board", color: "#76B900", textIcon: "NV", website: "https://developer.nvidia.com/nim", notice: { text: "Free access for NVIDIA Developer Program members (prototyping & testing).", apiKeyUrl: "https://build.nvidia.com/settings/api-keys" } },
  ollama: { id: "ollama", alias: "ollama", name: "Ollama Cloud", icon: "cloud", color: "#ffffffff", textIcon: "OL", website: "https://ollama.com", notice: { text: "Free tier: light usage, 1 cloud model at a time (limits reset every 5h & 7d). Pro $20/mo · Max $100/mo.", apiKeyUrl: "https://ollama.com/settings/keys" } },
  vertex: { id: "vertex", alias: "vx", name: "Vertex AI", icon: "cloud", color: "#4285F4", textIcon: "VX", website: "https://cloud.google.com/vertex-ai", notice: { text: "New Google Cloud accounts get $300 free credits. Requires GCP project + Service Account with Vertex AI API enabled.", apiKeyUrl: "https://console.cloud.google.com/iam-admin/serviceaccounts" } },
  gemini: { id: "gemini", alias: "gemini", name: "Gemini", icon: "diamond", color: "#4285F4", textIcon: "GE", website: "https://ai.google.dev", serviceKinds: ["llm", "embedding", "image", "imageToText", "webSearch"], searchViaChat: { defaultModel: "gemini-2.5-flash" } },
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
  claude: { id: "claude", alias: "cc", name: "Claude Code", icon: "smart_toy", color: "#D97757" },
  antigravity: { id: "antigravity", alias: "ag", name: "Antigravity", icon: "rocket_launch", color: "#F59E0B", deprecated: true, deprecationNotice: "AG is designed exclusively for Antigravity IDE. Using it with other tools (OpenClaw, Claude, Codex...) may result in account restrictions or bans." },
  codex: { id: "codex", alias: "cx", name: "OpenAI Codex", icon: "code", color: "#3B82F6", thinkingConfig: THINKING_CONFIG.effort, serviceKinds: ["llm", "image"], kindNotice: { image: "Requires a ChatGPT Plus (or higher) account. Free accounts are not supported for image generation." } },
  github: { id: "github", alias: "gh", name: "GitHub Copilot", icon: "code", color: "#333333" },
  cursor: { id: "cursor", alias: "cu", name: "Cursor IDE", icon: "edit_note", color: "#00D4AA" },
  // "kimi-coding": { id: "kimi-coding", alias: "kmc", name: "Kimi Coding", icon: "psychology", color: "#1E40AF", textIcon: "KC" },
  kilocode: { id: "kilocode", alias: "kc", name: "Kilo Code", icon: "code", color: "#FF6B35", textIcon: "KC" },
  cline: { id: "cline", alias: "cl", name: "Cline", icon: "smart_toy", color: "#5B9BD5", textIcon: "CL" },
  // opencode: { id: "opencode", alias: "oc", name: "OpenCode", icon: "terminal", color: "#E87040", textIcon: "OC" },
};

export const APIKEY_PROVIDERS = {
  glm: { id: "glm", alias: "glm", name: "GLM Coding", icon: "code", color: "#2563EB", textIcon: "GL", website: "https://open.bigmodel.cn" },
  "glm-cn": { id: "glm-cn", alias: "glm-cn", name: "GLM (China)", icon: "code", color: "#DC2626", textIcon: "GC", website: "https://open.bigmodel.cn" },
  kimi: { id: "kimi", alias: "kimi", name: "Kimi", icon: "psychology", color: "#1E3A8A", textIcon: "KM", website: "https://kimi.moonshot.cn", serviceKinds: ["llm", "webSearch"], searchViaChat: { defaultModel: "kimi-k2.5" } },
  minimax: { id: "minimax", alias: "minimax", name: "Minimax Coding", icon: "memory", color: "#7C3AED", textIcon: "MM", website: "https://www.minimaxi.com", serviceKinds: ["llm", "image", "imageToText", "webSearch"], searchViaChat: { defaultModel: "MiniMax-M2.7" } },
  "minimax-cn": { id: "minimax-cn", alias: "minimax-cn", name: "Minimax (China)", icon: "memory", color: "#DC2626", textIcon: "MC", website: "https://www.minimaxi.com" },
  alicode: { id: "alicode", alias: "alicode", name: "Alibaba", icon: "cloud", color: "#FF6A00", textIcon: "ALi" },
  "alicode-intl": { id: "alicode-intl", alias: "alicode-intl", name: "Alibaba Intl", icon: "cloud", color: "#FF6A00", textIcon: "ALi" },
  "volcengine-ark": { id: "volcengine-ark", alias: "ark", name: "Volcengine Ark", icon: "cloud", color: "#1677FF", textIcon: "ARK", website: "https://ark.cn-beijing.volces.com" },
  openai: { id: "openai", alias: "openai", name: "OpenAI", icon: "auto_awesome", color: "#10A37F", textIcon: "OA", website: "https://platform.openai.com", serviceKinds: ["llm", "embedding", "tts", "image", "imageToText", "webSearch"], thinkingConfig: THINKING_CONFIG.effort, searchViaChat: { defaultModel: "gpt-4o-mini" } },
  anthropic: { id: "anthropic", alias: "anthropic", name: "Anthropic", icon: "smart_toy", color: "#D97757", textIcon: "AN", website: "https://console.anthropic.com", serviceKinds: ["llm", "imageToText"] },
  "opencode-go": { id: "opencode-go", alias: "ocg", name: "OpenCode Go", icon: "terminal", color: "#E87040", textIcon: "OC", website: "https://opencode.ai/auth", notice: { text: "OpenCode Go subscription: $5/mo (then $10/mo). Access to Kimi, GLM, Qwen, MiMo, MiniMax models.", apiKeyUrl: "https://opencode.ai/auth" } },
  azure: { id: "azure", alias: "azure", name: "Azure OpenAI", icon: "cloud", color: "#0078D4", textIcon: "AZ", website: "https://azure.microsoft.com/en-us/products/ai-services/openai-service", hasProviderSpecificData: true },

  deepseek: { id: "deepseek", alias: "ds", name: "DeepSeek", icon: "bolt", color: "#4D6BFE", textIcon: "DS", website: "https://deepseek.com" },
  groq: { id: "groq", alias: "groq", name: "Groq", icon: "speed", color: "#F55036", textIcon: "GQ", website: "https://groq.com", serviceKinds: ["llm", "imageToText"] },
  xai: { id: "xai", alias: "xai", name: "xAI (Grok)", icon: "auto_awesome", color: "#1DA1F2", textIcon: "XA", website: "https://x.ai", serviceKinds: ["llm", "imageToText", "webSearch"], searchViaChat: { defaultModel: "grok-4.20-reasoning" } },
  mistral: { id: "mistral", alias: "mistral", name: "Mistral", icon: "air", color: "#FF7000", textIcon: "MI", website: "https://mistral.ai", serviceKinds: ["llm", "imageToText"] },
  perplexity: { id: "perplexity", alias: "pplx", name: "Perplexity", icon: "search", color: "#20808D", textIcon: "PP", website: "https://www.perplexity.ai", serviceKinds: ["llm", "webSearch"], searchConfig: { baseUrl: "https://api.perplexity.ai/search", method: "POST", authType: "apikey", authHeader: "bearer", costPerQuery: 0.005, freeMonthlyQuota: 0, searchTypes: ["web"], defaultMaxResults: 5, maxMaxResults: 20, timeoutMs: 10000, cacheTTLMs: 300000 } },
  together: { id: "together", alias: "together", name: "Together AI", icon: "group_work", color: "#0F6FFF", textIcon: "TG", website: "https://www.together.ai" },
  fireworks: { id: "fireworks", alias: "fireworks", name: "Fireworks AI", icon: "local_fire_department", color: "#7B2EF2", textIcon: "FW", website: "https://fireworks.ai" },
  cerebras: { id: "cerebras", alias: "cerebras", name: "Cerebras", icon: "memory", color: "#FF4F00", textIcon: "CB", website: "https://www.cerebras.ai" },
  cohere: { id: "cohere", alias: "cohere", name: "Cohere", icon: "hub", color: "#39594D", textIcon: "CO", website: "https://cohere.com" },
  nebius: { id: "nebius", alias: "nebius", name: "Nebius AI", icon: "cloud", color: "#6C5CE7", textIcon: "NB", website: "https://nebius.com" },
  siliconflow: { id: "siliconflow", alias: "siliconflow", name: "SiliconFlow", icon: "cloud_queue", color: "#5B6EF5", textIcon: "SF", website: "https://cloud.siliconflow.com" },
  hyperbolic: { id: "hyperbolic", alias: "hyp", name: "Hyperbolic", icon: "bolt", color: "#00D4FF", textIcon: "HY", website: "https://hyperbolic.xyz" },
  deepgram: { id: "deepgram", alias: "dg", name: "Deepgram", icon: "mic", color: "#13EF93", textIcon: "DG", website: "https://deepgram.com", serviceKinds: ["stt", "imageToText"] },
  assemblyai: { id: "assemblyai", alias: "aai", name: "AssemblyAI", icon: "record_voice_over", color: "#0062FF", textIcon: "AA", website: "https://assemblyai.com", serviceKinds: ["stt"] },
  nanobanana: { id: "nanobanana", alias: "nb", name: "NanoBanana", icon: "image", color: "#FFD700", textIcon: "NB", website: "https://nanobananaapi.ai", serviceKinds: ["image"] },
  elevenlabs: { id: "elevenlabs", alias: "el", name: "ElevenLabs", icon: "record_voice_over", color: "#6C47FF", textIcon: "EL", website: "https://elevenlabs.io", serviceKinds: ["tts"] },
  cartesia: { id: "cartesia", alias: "cartesia", name: "Cartesia", icon: "spatial_audio", color: "#FF4F8B", textIcon: "CA", website: "https://cartesia.ai", serviceKinds: ["tts"], hidden: true },
  playht: { id: "playht", alias: "playht", name: "PlayHT", icon: "play_circle", color: "#00B4D8", textIcon: "PH", website: "https://play.ht", serviceKinds: ["tts"], hidden: true },
  "local-device": { id: "local-device", alias: "local-device", name: "Local Device", icon: "speaker", color: "#64748B", textIcon: "LD", serviceKinds: ["tts"], noAuth: true },
  "google-tts": { id: "google-tts", alias: "google-tts", name: "Google TTS", icon: "record_voice_over", color: "#4285F4", textIcon: "GT", serviceKinds: ["tts"], noAuth: true },
  "edge-tts": { id: "edge-tts", alias: "edge-tts", name: "Edge TTS", icon: "record_voice_over", color: "#0078D4", textIcon: "ET", serviceKinds: ["tts"], noAuth: true },
  sdwebui: { id: "sdwebui", alias: "sdwebui", name: "SD WebUI", icon: "brush", color: "#FF7043", textIcon: "SD", website: "https://github.com/AUTOMATIC1111/stable-diffusion-webui", serviceKinds: ["image"] },
  comfyui: { id: "comfyui", alias: "comfyui", name: "ComfyUI", icon: "account_tree", color: "#4CAF50", textIcon: "CF", website: "https://github.com/comfyanonymous/ComfyUI", serviceKinds: ["image"] },
  huggingface: { id: "huggingface", alias: "hf", name: "HuggingFace", icon: "face", color: "#FFD21E", textIcon: "HF", website: "https://huggingface.co", serviceKinds: ["image", "imageToText", "tts"], hiddenKinds: ["tts"] },
  blackbox: { id: "blackbox", alias: "bb", name: "Blackbox AI", icon: "smart_toy", color: "#5B5FEF", textIcon: "BB", website: "https://blackbox.ai", serviceKinds: ["llm"] },
  chutes: { id: "chutes", alias: "ch", name: "Chutes AI", icon: "water_drop", color: "#ffffffff", textIcon: "CH", website: "https://chutes.ai" },
  "ollama-local": { id: "ollama-local", alias: "ollama-local", name: "Ollama Local", icon: "cloud", color: "#ffffffff", textIcon: "OL", website: "https://ollama.com" },
  "vertex-partner": { id: "vertex-partner", alias: "vxp", name: "Vertex Partner", icon: "cloud", color: "#34A853", textIcon: "VP", website: "https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-partner-models" },
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
  { id: "stt",         label: "STT",            icon: "mic",               endpoint: { method: "POST", path: "/v1/audio/transcriptions" } },
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
  return Object.values(AI_PROVIDERS).filter((p) => {
    const kinds = p.serviceKinds ?? ["llm"];
    if (!kinds.includes(kind)) return false;
    if (p.hidden) return false; // globally hidden
    if (p.hiddenKinds?.includes(kind)) return false; // hidden for specific kind
    return true;
  });
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
];
