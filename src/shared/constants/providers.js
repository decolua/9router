// Provider definitions

// Free Providers (kiro first, iflow last)
export const FREE_PROVIDERS = {
  kiro: { id: "kiro", alias: "kr", name: "Kiro AI", icon: "psychology_alt", color: "#FF6B35" },
  qwen: { id: "qwen", alias: "qw", name: "Qwen Code", icon: "psychology", color: "#10B981" },
  "gemini-cli": { id: "gemini-cli", alias: "gc", name: "Gemini CLI", icon: "terminal", color: "#4285F4", deprecated: true, deprecationNotice: "Google has tightened Gemini CLI abuse detection and restricted Pro models to paid accounts (Mar 25, 2026). Using this provider may violate ToS and risk account bans." },
  // gitlab: { id: "gitlab", alias: "gl", name: "GitLab Duo", icon: "code", color: "#FC6D26" },
  // codebuddy: { id: "codebuddy", alias: "cb", name: "CodeBuddy", icon: "smart_toy", color: "#006EFF" },
  // qoder: { id: "qoder", alias: "qd", name: "Qoder AI", icon: "water_drop", color: "#EC4899" },
  iflow: { id: "iflow", alias: "if", name: "iFlow AI", icon: "water_drop", color: "#6366F1" },
  opencode: { id: "opencode", alias: "oc", name: "OpenCode", icon: "terminal", color: "#E87040", textIcon: "OC", noAuth: true },
};

// Free Tier Providers (has free access but may require account/API key)
export const FREE_TIER_PROVIDERS = {
  openrouter: { id: "openrouter", alias: "openrouter", name: "OpenRouter", icon: "router", color: "#F97316", textIcon: "OR", website: "https://openrouter.ai", notice: { text: "Free tier: 27+ free models, no credit card needed, 200 req/day. After $10 credit: 1,000 req/day.", apiKeyUrl: "https://openrouter.ai/settings/keys" }, modelsFetcher: { url: "https://openrouter.ai/api/v1/models", type: "openrouter-free" }, passthroughModels: true },
  nvidia: { id: "nvidia", alias: "nvidia", name: "NVIDIA NIM", icon: "developer_board", color: "#76B900", textIcon: "NV", website: "https://developer.nvidia.com/nim", notice: { text: "Free access for NVIDIA Developer Program members (prototyping & testing).", apiKeyUrl: "https://build.nvidia.com/settings/api-keys" } },
  ollama: { id: "ollama", alias: "ollama", name: "Ollama Cloud", icon: "cloud", color: "#ffffffff", textIcon: "OL", website: "https://ollama.com", notice: { text: "Free tier: light usage, 1 cloud model at a time (limits reset every 5h & 7d). Pro $20/mo · Max $100/mo.", apiKeyUrl: "https://ollama.com/settings/keys" } },
  vertex: { id: "vertex", alias: "vx", name: "Vertex AI", icon: "cloud", color: "#4285F4", textIcon: "VX", website: "https://cloud.google.com/vertex-ai", notice: { text: "New Google Cloud accounts get $300 free credits. Requires GCP project + Service Account with Vertex AI API enabled.", apiKeyUrl: "https://console.cloud.google.com/iam-admin/serviceaccounts" } },
  gemini: { id: "gemini", alias: "gemini", name: "Gemini", icon: "diamond", color: "#4285F4", textIcon: "GE", website: "https://ai.google.dev", serviceKinds: ["llm", "embedding"] },
};

// OAuth Providers
export const OAUTH_PROVIDERS = {
  claude: { id: "claude", alias: "cc", name: "Claude Code", icon: "smart_toy", color: "#D97757" },
  antigravity: { id: "antigravity", alias: "ag", name: "Antigravity", icon: "rocket_launch", color: "#F59E0B", deprecated: true, deprecationNotice: "Antigravity has tightened abuse detection and restricted model access. Using this provider may violate ToS and risk account bans." },
  codex: { id: "codex", alias: "cx", name: "OpenAI Codex", icon: "code", color: "#3B82F6" },
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
  kimi: { id: "kimi", alias: "kimi", name: "Kimi", icon: "psychology", color: "#1E3A8A", textIcon: "KM", website: "https://kimi.moonshot.cn" },
  minimax: { id: "minimax", alias: "minimax", name: "Minimax Coding", icon: "memory", color: "#7C3AED", textIcon: "MM", website: "https://www.minimaxi.com" },
  "minimax-cn": { id: "minimax-cn", alias: "minimax-cn", name: "Minimax (China)", icon: "memory", color: "#DC2626", textIcon: "MC", website: "https://www.minimaxi.com" },
  alicode: { id: "alicode", alias: "alicode", name: "Alibaba", icon: "cloud", color: "#FF6A00", textIcon: "ALi" },
  "alicode-intl": { id: "alicode-intl", alias: "alicode-intl", name: "Alibaba Intl", icon: "cloud", color: "#FF6A00", textIcon: "ALi" },
  openai: { id: "openai", alias: "openai", name: "OpenAI", icon: "auto_awesome", color: "#10A37F", textIcon: "OA", website: "https://platform.openai.com", serviceKinds: ["llm", "embedding", "tts"] },
  anthropic: { id: "anthropic", alias: "anthropic", name: "Anthropic", icon: "smart_toy", color: "#D97757", textIcon: "AN", website: "https://console.anthropic.com", serviceKinds: ["llm"] },


  deepseek: { id: "deepseek", alias: "ds", name: "DeepSeek", icon: "bolt", color: "#4D6BFE", textIcon: "DS", website: "https://deepseek.com" },
  groq: { id: "groq", alias: "groq", name: "Groq", icon: "speed", color: "#F55036", textIcon: "GQ", website: "https://groq.com" },
  xai: { id: "xai", alias: "xai", name: "xAI (Grok)", icon: "auto_awesome", color: "#1DA1F2", textIcon: "XA", website: "https://x.ai" },
  mistral: { id: "mistral", alias: "mistral", name: "Mistral", icon: "air", color: "#FF7000", textIcon: "MI", website: "https://mistral.ai" },
  perplexity: { id: "perplexity", alias: "pplx", name: "Perplexity", icon: "search", color: "#20808D", textIcon: "PP", website: "https://www.perplexity.ai" },
  together: { id: "together", alias: "together", name: "Together AI", icon: "group_work", color: "#0F6FFF", textIcon: "TG", website: "https://www.together.ai" },
  fireworks: { id: "fireworks", alias: "fireworks", name: "Fireworks AI", icon: "local_fire_department", color: "#7B2EF2", textIcon: "FW", website: "https://fireworks.ai" },
  cerebras: { id: "cerebras", alias: "cerebras", name: "Cerebras", icon: "memory", color: "#FF4F00", textIcon: "CB", website: "https://www.cerebras.ai" },
  cohere: { id: "cohere", alias: "cohere", name: "Cohere", icon: "hub", color: "#39594D", textIcon: "CO", website: "https://cohere.com" },
  nebius: { id: "nebius", alias: "nebius", name: "Nebius AI", icon: "cloud", color: "#6C5CE7", textIcon: "NB", website: "https://nebius.com" },
  siliconflow: { id: "siliconflow", alias: "siliconflow", name: "SiliconFlow", icon: "cloud_queue", color: "#5B6EF5", textIcon: "SF", website: "https://cloud.siliconflow.com" },
  hyperbolic: { id: "hyperbolic", alias: "hyp", name: "Hyperbolic", icon: "bolt", color: "#00D4FF", textIcon: "HY", website: "https://hyperbolic.xyz" },
  deepgram: { id: "deepgram", alias: "dg", name: "Deepgram", icon: "mic", color: "#13EF93", textIcon: "DG", website: "https://deepgram.com", serviceKinds: ["stt"] },
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
  huggingface: { id: "huggingface", alias: "hf", name: "HuggingFace", icon: "face", color: "#FFD21E", textIcon: "HF", website: "https://huggingface.co", serviceKinds: ["image", "tts"], hiddenKinds: ["tts"] },
  chutes: { id: "chutes", alias: "ch", name: "Chutes AI", icon: "water_drop", color: "#ffffffff", textIcon: "CH", website: "https://chutes.ai" },
  "ollama-local": { id: "ollama-local", alias: "ollama-local", name: "Ollama Local", icon: "cloud", color: "#ffffffff", textIcon: "OL", website: "https://ollama.com" },
  "vertex-partner": { id: "vertex-partner", alias: "vxp", name: "Vertex Partner", icon: "cloud", color: "#34A853", textIcon: "VP", website: "https://cloud.google.com/vertex-ai/generative-ai/docs/partner-models/use-partner-models" },
};

// Media provider kinds — each kind maps to a route and endpoint config
export const MEDIA_PROVIDER_KINDS = [
  { id: "embedding", label: "Embedding", icon: "data_array",      endpoint: { method: "POST", path: "/v1/embeddings" } },
  { id: "image",     label: "Image",     icon: "image",            endpoint: { method: "POST", path: "/v1/images/generations" } },
  { id: "tts",       label: "Text To Speech", icon: "record_voice_over", endpoint: { method: "POST", path: "/v1/audio/speech" } },
  { id: "stt",       label: "STT",       icon: "mic",              endpoint: { method: "POST", path: "/v1/audio/transcriptions" } },
  { id: "video",     label: "Video",     icon: "movie",            endpoint: { method: "POST", path: "/v1/video/generations" } },
  { id: "music",     label: "Music",     icon: "music_note",       endpoint: { method: "POST", path: "/v1/audio/music" } },
];

export const OPENAI_COMPATIBLE_PREFIX = "openai-compatible-";
export const ANTHROPIC_COMPATIBLE_PREFIX = "anthropic-compatible-";

export function isOpenAICompatibleProvider(providerId) {
  return typeof providerId === "string" && providerId.startsWith(OPENAI_COMPATIBLE_PREFIX);
}

export function isAnthropicCompatibleProvider(providerId) {
  return typeof providerId === "string" && providerId.startsWith(ANTHROPIC_COMPATIBLE_PREFIX);
}

// All providers (combined)
export const AI_PROVIDERS = { ...FREE_PROVIDERS, ...FREE_TIER_PROVIDERS, ...OAUTH_PROVIDERS, ...APIKEY_PROVIDERS };

// Auth methods
export const AUTH_METHODS = {
  oauth: { id: "oauth", name: "OAuth", icon: "lock" },
  apikey: { id: "apikey", name: "API Key", icon: "key" },
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
];
