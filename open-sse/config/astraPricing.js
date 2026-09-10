// Official API-equivalent USD / 1M tokens; never a Codex subscription charge.
// https://developers.openai.com/api/docs/models/gpt-6-astra
// https://developers.openai.com/api/docs/pricing
export const ASTRA_MODEL = 'gpt-6-astra';
export const ASTRA_PROVIDERS = ['openai', 'codex', 'cx'];
export const ASTRA_PRICING = {
  input: 10, cached: 1, cache_creation: 12.5, output: 50,
  reasoning_in_output: true,
  long_context: { above: 272000, input: 20, cached: 2, cache_creation: 25, output: 75 },
  tier_multipliers: { standard: 1, default: 1, batch: 0.5, flex: 0.5, fast: 2, priority: 2 },
};

// Price lookup only: do not use this to rewrite routed/stored model IDs.
export function normalizeAstraPricingModel(provider, model) {
  if (!ASTRA_PROVIDERS.includes(provider) || typeof model !== 'string') return null;
  const parts = model.split('/');
  if (parts.length > 2 || (parts.length === 2 && !ASTRA_PROVIDERS.includes(parts[0]))) return null;
  const base = parts.at(-1);
  return /^gpt-6-astra(?:\((?:low|medium|high|xhigh|max)\))?$/.test(base) ? ASTRA_MODEL : null;
}
