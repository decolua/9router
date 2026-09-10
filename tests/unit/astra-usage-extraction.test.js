import { it, expect } from 'vitest';
import { extractUsage, canonicalizeUsage, mergeUsage } from '../../open-sse/utils/usageTracking.js';
it('preserves the latest explicit service tier across usage chunks for cost', () => {
  const start = extractUsage({usage:{prompt_tokens:0,completion_tokens:0}});
  const end = extractUsage({service_tier:'fast',usage:{prompt_tokens:1000,completion_tokens:100}});
  const merged = mergeUsage(start,end);
  expect(merged.service_tier).toBe('fast');
  expect(calculateCostFromTokens(canonicalizeUsage(merged),getPricingForModel('codex','gpt-6-astra'))).toBeCloseTo((1000*10+100*50)*2/1e6,10);
  expect(mergeUsage(merged,{completion_tokens:100}).service_tier).toBe('fast');
  expect(mergeUsage(merged,{service_tier:'flex'}).service_tier).toBe('flex');
});
import { getPricingForModel, calculateCostFromTokens } from '../../open-sse/providers/pricing.js';
it('keeps Responses cache-write-only input inclusive through canonical totals and cost', () => {
  const extracted = extractUsage({type:'response.completed', response:{usage:{input_tokens:1000,output_tokens:100,input_tokens_details:{cache_write_tokens:1000}}}});
  const tokens = canonicalizeUsage(extracted);
  expect(tokens).toMatchObject({prompt_tokens:1000,total_tokens:1100,cached_tokens:0,cache_creation_input_tokens:1000});
  expect(extracted.cached_tokens).toBe(0);
  expect(canonicalizeUsage(tokens)).toEqual(tokens);
  expect(calculateCostFromTokens(tokens,getPricingForModel('codex','gpt-6-astra'))).toBeCloseTo((1000*12.5+100*50)/1e6,10);
});
it('retains official Responses cache writes and returned processing tier through the streaming cost path', () => {
  const upstream = { type: 'response.completed', response: { service_tier: 'fast', usage: { input_tokens: 15000, output_tokens: 100, input_tokens_details: { cached_tokens: 12000, cache_write_tokens: 3000 }, output_tokens_details: { reasoning_tokens: 80 } } } };
  const tokens = canonicalizeUsage(extractUsage(upstream));
  expect(tokens).toMatchObject({ prompt_tokens: 15000, cached_tokens: 12000, cache_creation_input_tokens: 3000, service_tier: 'fast' });
  expect(canonicalizeUsage(tokens)).toEqual(tokens);
  expect(calculateCostFromTokens(tokens, getPricingForModel('codex', 'gpt-6-astra(low)'))).toBeCloseTo((12000 + 3000 * 12.5 + 100 * 50) * 2 / 1e6, 10);
});
it('retains cache-write detail and effective service tier from Chat Completions', () => {
  const tokens = canonicalizeUsage(extractUsage({ service_tier: 'flex', usage: { prompt_tokens: 15000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 12000, cache_write_tokens: 3000 } } }));
  expect(tokens).toMatchObject({ prompt_tokens: 15000, cache_creation_input_tokens: 3000, service_tier: 'flex' });
});
