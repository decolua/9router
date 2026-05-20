// Shared provider prefix map for CLI tool cards
// Map provider alias prefix → { name, icon }
export const PROVIDER_PREFIX_MAP = {
  sp: { name: "SumoPod", icon: "/providers/sumopod.png" },
  x5l: { name: "X5Lab", icon: "/providers/x5lab.png" },
  cc: { name: "Claude Code", icon: "/providers/claude.png" },
  cx: { name: "OpenAI Codex", icon: "/providers/codex.png" },
  glm: { name: "GLM", icon: "/providers/glm.png" },
  "glm-cn": { name: "GLM (China)", icon: "/providers/glm-cn.png" },
  gemini: { name: "Gemini", icon: "/providers/gemini.png" },
  ds: { name: "DeepSeek", icon: "/providers/deepseek.png" },
  openrouter: { name: "OpenRouter", icon: "/providers/openrouter.png" },
  kr: { name: "Kiro AI", icon: "/providers/kiro.png" },
  oc: { name: "OpenCode", icon: "/providers/opencode.png" },
  ocg: { name: "OpenCode Go", icon: "/providers/opencode-go.png" },
  anthropic: { name: "Anthropic", icon: "/providers/anthropic.png" },
  openai: { name: "OpenAI", icon: "/providers/openai.png" },
  vx: { name: "Vertex AI", icon: "/providers/vertex.png" },
  vxp: { name: "Vertex Partner", icon: "/providers/vertex-partner.png" },
  xai: { name: "xAI (Grok)", icon: "/providers/xai.png" },
  mistral: { name: "Mistral", icon: "/providers/mistral.png" },
  groq: { name: "Groq", icon: "/providers/groq.png" },
  kimi: { name: "Kimi", icon: "/providers/kimi.png" },
  minimax: { name: "Minimax", icon: "/providers/minimax.png" },
  "minimax-cn": { name: "Minimax (China)", icon: "/providers/minimax-cn.png" },
  alicode: { name: "Alibaba", icon: "/providers/alicode.png" },
  "alicode-intl": { name: "Alibaba Intl", icon: "/providers/alicode-intl.png" },
  deepseek: { name: "DeepSeek", icon: "/providers/deepseek.png" },
  ollama: { name: "Ollama", icon: "/providers/ollama.png" },
  "ollama-local": { name: "Ollama Local", icon: "/providers/ollama-local.png" },
  azure: { name: "Azure OpenAI", icon: "/providers/azure.png" },
  gh: { name: "GitHub Copilot", icon: "/providers/copilot.png" },
  gc: { name: "Gemini CLI", icon: "/providers/gemini-cli.png" },
  ag: { name: "Antigravity", icon: "/providers/antigravity.png" },
  nvidia: { name: "NVIDIA NIM", icon: "/providers/nvidia.png" },
  together: { name: "Together AI", icon: "/providers/together.png" },
  fireworks: { name: "Fireworks AI", icon: "/providers/fireworks.png" },
  cerebras: { name: "Cerebras", icon: "/providers/cerebras.png" },
  cohere: { name: "Cohere", icon: "/providers/cohere.png" },
  nebius: { name: "Nebius AI", icon: "/providers/nebius.png" },
  siliconflow: { name: "SiliconFlow", icon: "/providers/siliconflow.png" },
  hyp: { name: "Hyperbolic", icon: "/providers/hyperbolic.png" },
  perplexity: { name: "Perplexity", icon: "/providers/perplexity.png" },
  xmtp: { name: "Xiaomi MiMo", icon: "/providers/xiaomi-tokenplan.png" },
  mimo: { name: "Xiaomi MiMo", icon: "/providers/xiaomi-mimo.png" },
  ark: { name: "Volcengine Ark", icon: "/providers/volcengine-ark.png" },
  kc: { name: "Kilo Code", icon: "/providers/kilocode.png" },
  cl: { name: "Cline", icon: "/providers/cline.png" },
  cu: { name: "Cursor", icon: "/providers/cursor.png" },
  vercel: { name: "Vercel AI Gateway", icon: "/providers/openai.png" },
  chutes: { name: "Chutes AI", icon: "/providers/chutes.png" },
  blackbox: { name: "Blackbox AI", icon: "/providers/blackbox.png" },
  byteplus: { name: "BytePlus", icon: "/providers/byteplus.png" },
};

export function getProviderInfo(modelValue) {
  const slashIdx = modelValue.indexOf("/");
  if (slashIdx === -1) return { prefix: "__combo__", modelName: modelValue, name: "Combos", icon: null, isCombo: true };
  const prefix = modelValue.slice(0, slashIdx);
  const modelName = modelValue.slice(slashIdx + 1);
  const info = PROVIDER_PREFIX_MAP[prefix];
  return {
    prefix,
    modelName,
    name: info?.name || prefix,
    icon: info?.icon || null,
    isCombo: false,
  };
}

export function groupModelsByProvider(models) {
  const groups = {};
  for (const model of models) {
    const { prefix, name, icon, isCombo } = getProviderInfo(model);
    const key = prefix || "__other__";
    if (!groups[key]) groups[key] = { name, icon, models: [], isCombo: isCombo || false };
    groups[key].models.push(model);
  }
  for (const group of Object.values(groups)) {
    group.models.sort((a, b) => a.localeCompare(b));
  }
  return Object.fromEntries(
    Object.entries(groups).sort(([, a], [, b]) => a.name.localeCompare(b.name))
  );
}
