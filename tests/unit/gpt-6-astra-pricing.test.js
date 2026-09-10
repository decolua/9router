import { it, expect } from 'vitest';
import { getPricingForModel, calculateCostFromTokens } from '../../open-sse/providers/pricing.js';
it.each(['openai', 'codex', 'cx'])('prices Astra on %s without treating reasoning effort as a different price', provider => {
  for (const model of ['gpt-6-astra', 'gpt-6-astra(low)', `${provider}/gpt-6-astra(high)`]) {
    const price = getPricingForModel(provider, model);
    expect(price).toMatchObject({ input: 10, cached: 1, cache_creation: 12.5, output: 50 });
    expect(calculateCostFromTokens({ prompt_tokens: 1000, cached_tokens: 200, cache_creation_input_tokens: 100, completion_tokens: 100 }, price)).toBeCloseTo((700 * 10 + 200 + 100 * 12.5 + 100 * 50) / 1e6, 10);
  }
});
it.each([271999, 272000, 272001])('applies long-context full-request rates only above 272000 input tokens (%s)', input => {
  const long = input > 272000;
  const tokens = { prompt_tokens: input, cached_tokens: 270000, cache_creation_input_tokens: 1000, completion_tokens: 100 };
  expect(calculateCostFromTokens(tokens, getPricingForModel('codex', 'gpt-6-astra(low)'))).toBeCloseTo(((input - 271000) * (long ? 20 : 10) + 270000 * (long ? 2 : 1) + 1000 * (long ? 25 : 12.5) + 100 * (long ? 75 : 50)) / 1e6, 10);
});
it.each([['standard', 1], ['default', 1], ['batch', .5], ['flex', .5], ['fast', 2], ['priority', 2]])('applies recorded %s tier to every long-context rate', (service_tier, multiplier) => {
  const tokens = { prompt_tokens: 300000, cached_tokens: 200000, cache_creation_input_tokens: 50000, completion_tokens: 100, service_tier };
  expect(calculateCostFromTokens(tokens, getPricingForModel('openai', 'gpt-6-astra'))).toBeCloseTo((50000 * 20 + 200000 * 2 + 50000 * 25 + 100 * 75) * multiplier / 1e6, 10);
});
it('does not double charge reasoning tokens already included in Astra output', () => {
  expect(calculateCostFromTokens({ prompt_tokens: 0, completion_tokens: 100, reasoning_tokens: 80 }, getPricingForModel('openai', 'gpt-6-astra'))).toBeCloseTo(100 * 50 / 1e6, 10);
});
it('marks an unrecognized explicit tier as unsupported rather than inventing a rate', () => {
  expect(Number.isFinite(calculateCostFromTokens({ prompt_tokens: 100, service_tier: 'unknown-tier' }, getPricingForModel('openai', 'gpt-6-astra')))).toBe(false);
});
it('does not extend official prices to resellers, unknown variants or conflicting namespaces', () => {
  for (const [provider, model] of [['other', 'gpt-6-astra'], ['openai', 'gpt-6-astra-future'], ['openai', 'other/gpt-6-astra'], ['openai', 'gpt-6-astra(none)']]) expect(getPricingForModel(provider, model)).toBeNull();
});
