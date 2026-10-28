// Mapping of 9router provider ids/aliases → candidate models.dev provider ids.
// First candidate that exists in the fetched catalog wins; if none matches,
// fall back to exact/normalized id matching against the catalog.
//
// models.dev catalog: https://models.dev/api.json

export const MODELS_DEV_PROVIDER_CANDIDATES = {
  claude: ["anthropic"],
  anthropic: ["anthropic"],
  gemini: ["google"],
  "gemini-cli": ["google"],
  antigravity: ["google"],
  vertex: ["google-vertex", "google"],
  "vertex-partner": ["google-vertex-anthropic", "google-vertex", "google"],
  openai: ["openai"],
  codex: ["openai"],
  openrouter: ["openrouter"],
  deepseek: ["deepseek"],
  groq: ["groq"],
  xai: ["xai"],
  "grok-cli": ["xai"],
  "grok-web": ["xai"],
  mistral: ["mistral"],
  perplexity: ["perplexity"],
  "perplexity-agent": ["perplexity-agent", "perplexity"],
  together: ["togetherai"],
  fireworks: ["fireworks-ai"],
  cerebras: ["cerebras"],
  cohere: ["cohere"],
  nebius: ["nebius"],
  siliconflow: ["siliconflow", "siliconflow-cn"],
  hyperbolic: ["hyperbolic", "hyper"],
  chutes: ["chutes"],
  nvidia: ["nvidia"],
  "vercel-ai-gateway": ["vercel"],
  qwen: ["alibaba", "alibaba-cn"],
  alicode: ["alibaba-coding-plan-cn", "alibaba-coding-plan", "alibaba"],
  "alicode-intl": ["alibaba-coding-plan", "alibaba"],
  "alims-intl": ["alibaba"],
  kilocode: ["kilo"],
  "kilo-gateway": ["kilo"],
  kimi: ["moonshotai"],
  "kimi-for-coding": ["kimi-for-coding", "moonshotai"],
  glm: ["zai", "zai-coding-plan"],
  "glm-cn": ["zhipuai", "zhipuai-coding-plan"],
  minimax: ["minimax", "minimax-coding-plan"],
  "minimax-cn": ["minimax-cn", "minimax-cn-coding-plan", "minimax"],
  iflow: ["iflowcn"],
  github: ["github-copilot"],
  gitlab: ["gitlab"],
  huggingface: ["huggingface"],
  venice: ["venice"],
  morph: ["morph"],
  poolside: ["poolside"],
  ollama: ["ollama-cloud"],
  "xiaomi-mimo": ["xiaomi"],
  "mimo-free": ["xiaomi"],
  "xiaomi-tokenplan": ["xiaomi-token-plan-cn", "xiaomi"],
  opencode: ["opencode"],
  "opencode-go": ["opencode-go"],
  tencent: ["tencent-coding-plan", "tencent-tokenhub"],
  "codebuddy-cn": ["tencent-coding-plan", "tencent-tokenhub"],
  "codebuddy-intl": ["tencent-coding-plan", "tencent-tokenhub"],
  azure: ["azure"],
  "cloudflare-ai": ["cloudflare-workers-ai", "cloudflare-ai-gateway"],
  sambanova: ["sambanova"],
};

function normalizeId(id) {
  return String(id).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Resolve a 9router provider id/alias to a models.dev provider id.
 * @param {string} providerKey - 9router provider id or alias
 * @param {Iterable<string>} catalogIds - provider ids present in the models.dev catalog
 * @returns {string|null} models.dev provider id or null when unmappable
 */
export function resolveModelsDevProviderId(providerKey, catalogIds) {
  if (!providerKey) return null;
  const ids = catalogIds instanceof Set ? catalogIds : new Set(catalogIds || []);

  const candidates = MODELS_DEV_PROVIDER_CANDIDATES[providerKey] || [];
  for (const candidate of candidates) {
    if (ids.has(candidate)) return candidate;
  }

  // Exact id match
  if (ids.has(providerKey)) return providerKey;

  // Normalized match (strip dashes/case): "vercel-ai-gateway" → "vercelaigateway"
  const normalized = normalizeId(providerKey);
  for (const id of ids) {
    if (normalizeId(id) === normalized) return id;
  }

  return null;
}
