import { beforeAll, beforeEach, it, expect } from 'vitest';
let db, usage, pricing;
beforeAll(async () => {
  if (!process.env.HOME?.includes('.analytics-pricing-home') || !process.env.DATA_DIR?.includes('.analytics-pricing-data')) throw new Error('Run with isolated analytics-pricing HOME/DATA_DIR');
  const { mkdtempSync } = await import('node:fs');
  process.env.DATA_DIR = mkdtempSync(process.env.DATA_DIR + '/astra-');
  db = await (await import('../../src/lib/db/driver.js')).getAdapter();
  usage = await import('../../src/lib/db/repos/usageRepo.js');
  pricing = await import('../../src/lib/db/repos/pricingRepo.js');
});
beforeEach(async () => {
  for (const table of ['usageHistory', 'usageDaily', 'apiKeys']) db.run(`DELETE FROM ${table}`);
  await pricing.resetAllPricing();
  global._recentRing.items = []; global._recentRing.initialized = false;
});
const entry = extra => ({ provider: 'codex', model: 'gpt-6-astra(low)', tokens: { prompt_tokens: 300000, cached_tokens: 200000, cache_creation_input_tokens: 50000, completion_tokens: 100, reasoning_tokens: 80 }, ...extra });
it('persists real calculated estimates without rewriting model IDs and leaves historical costs unsupported', async () => {
  const e = entry();
  await usage.saveRequestUsage(e);
  const row = db.get('SELECT model, cost, meta FROM usageHistory');
  expect(row.model).toBe('gpt-6-astra(low)');
  expect(row.cost).toBeCloseTo(2.6575, 10);
  expect(JSON.parse(row.meta).costSupported).toBe(true);
  await usage.saveRequestUsage(entry({ model: 'unknown-fixture' }));
  db.run('UPDATE usageHistory SET cost = 999, meta = ? WHERE model = ?', ['{}', 'unknown-fixture']);
  const a = (await usage.getUsageStats('all')).clientKeyAnalytics;
  expect(a.totals).toMatchObject({ requests: 2, costSupportedRequests: 1 });
  expect(a.totals.cost).toBeCloseTo(2.6575, 10);
});
it('honors canonical custom prices for effort-suffixed lookup without built-in tier/context overrides', async () => {
  await pricing.updatePricing({ codex: { 'gpt-6-astra': { input: 2, cached: 0, cache_creation: 0, output: 3 } } });
  await usage.saveRequestUsage(entry());
  expect(db.get('SELECT cost FROM usageHistory').cost).toBeCloseTo((50000 * 2 + 100 * 3) / 1e6, 10);
});
it('gives exact variant overrides precedence over canonical overrides, including free pricing', async () => {
  await pricing.updatePricing({ codex: { 'gpt-6-astra': { input: 2, output: 3 }, 'gpt-6-astra(low)': { input: 0, output: 0, cached: 0, cache_creation: 0 } } });
  await usage.saveRequestUsage(entry());
  const a = (await usage.getUsageStats('all')).clientKeyAnalytics;
  expect(a.rows[0]).toMatchObject({ cost: 0, costSupportedRequests: 1, costShare: 0 });
});
it('keeps unknown processing tiers unpriced without poisoning totals', async () => {
  const e = entry(); e.tokens.service_tier = 'unrecognized';
  await usage.saveRequestUsage(e);
  const a = (await usage.getUsageStats('all')).clientKeyAnalytics;
  expect(a.rows[0]).toMatchObject({ cost: null, costSupportedRequests: 0, costShare: null });
  expect(db.get('SELECT cost FROM usageHistory').cost).toBe(0);
});
