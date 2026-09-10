import { beforeAll, beforeEach, afterEach, vi, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let db, usage;
afterEach(() => vi.useRealTimers());
it.each([['today', 1], ['7d', 7], ['30d', 30], ['60d', 60]])('aligns %s retained usage with calendar-day totals', async (period, days) => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 10, 12, 0, 0));
  const cutoff = new Date(2026, 8, 10 - days + 1);
  await usage.saveRequestUsage(record({ timestamp: new Date(cutoff.getTime() - 1).toISOString() }));
  await usage.saveRequestUsage(record({ timestamp: cutoff.toISOString() }));
  await usage.saveRequestUsage(record());
  const stats = await usage.getUsageStats(period);
  expect(stats.totalRequests).toBe(2);
  expect(stats.clientKeyAnalytics.recordCount).toBe(stats.totalRequests);
});
beforeAll(async () => {
  process.env.DATA_DIR = mkdtempSync(join(tmpdir(), '9router-client-test-'));
  db = await (await import('../../src/lib/db/driver.js')).getAdapter();
  usage = await import('../../src/lib/db/repos/usageRepo.js');
});
beforeEach(() => {
  for (const table of ['usageHistory', 'usageDaily', 'apiKeys']) db.run(`DELETE FROM ${table}`);
  global._recentRing.items = []; global._recentRing.initialized = false;
  db.run('INSERT INTO apiKeys(id, key, name, isActive, createdAt) VALUES (?, ?, ?, ?, ?)', ['client-a', 'fixture-client-a', 'Client Alpha', 1, '2020-01-01T00:00:00Z']);
});
it('aggregates retained history by stable ID, with explicit unknown outcomes and unsupported cost', async () => {
  const now = Date.now();
  await usage.saveRequestUsage(record({ timestamp: new Date(now - 3000).toISOString() }));
  await usage.saveRequestUsage(record({ timestamp: new Date(now - 2000).toISOString(), status: 'error', tokens: {} }));
  await usage.saveRequestUsage(record({ timestamp: new Date(now - 1000).toISOString(), status: undefined }));
  await usage.saveRequestUsage(record({ apiKey: null, status: 'pending' }));
  const stats = await usage.getUsageStats('24h');
  expect(stats.clientKeyAnalytics).toMatchObject({ scope: 'retained-history', period: '24h', recordCount: 4 });
  const a = stats.clientKeyAnalytics.rows.find(r => r.clientKeyId === 'client-a');
  expect(a).toMatchObject({ requests: 3, promptTokens: 24, completionTokens: 6, successes: 1, errors: 1, unknown: 1, cost: null, costSupportedRequests: 0 });
  expect(a.successRate).toBeCloseTo(100 / 3);
  expect(a.errorRate).toBeCloseTo(100 / 3);
  expect(stats.clientKeyAnalytics.rows.find(r => r.clientKeyId === null)).toMatchObject({ clientKeyName: 'Unknown', unknown: 1 });
  expect(stats.recentRequests).toHaveLength(4);
  expect((await usage.getActiveRequests()).recentRequests).toHaveLength(4);
});
it('only counts cost with pricing provenance, including genuinely free pricing', async () => {
  await usage.saveRequestUsage(record({ provider: 'openai', model: 'gpt-4o' }));
  const analytics = (await usage.getUsageStats('all')).clientKeyAnalytics;
  expect(analytics.rows[0].costSupportedRequests).toBe(1);
  expect(analytics.rows[0].cost).toBeGreaterThan(0);
});
it('retains deleted identities, follows renames, separates identical names and preserves Unknown history', async () => {
  await usage.saveRequestUsage(record({ timestamp: '2026-01-01T00:00:00Z' }));
  db.run('UPDATE apiKeys SET name = ? WHERE id = ?', ['Renamed', 'client-a']);
  expect((await usage.getUsageStats()).recentRequests[0].clientKeyName).toBe('Renamed');
  db.run('DELETE FROM apiKeys');
  global._recentRing.initialized = false;
  expect((await usage.getActiveRequests()).recentRequests[0]).toMatchObject({ clientKeyId: 'client-a', clientKeyName: 'Client Alpha', clientKeyDeleted: true });
  db.run('INSERT INTO apiKeys(id, key, name, isActive, createdAt) VALUES (?, ?, ?, ?, ?)', ['client-b', 'fixture-client-b', 'Client Alpha', 1, '2020-01-01']);
  await usage.saveRequestUsage(record({ apiKey: 'fixture-client-b', timestamp: '2026-01-02T00:00:00Z' }));
  await usage.saveRequestUsage(record({ apiKey: 'unrecognized-legacy-fixture', timestamp: '2026-01-03T00:00:00Z' }));
  const a = (await usage.getUsageStats('all')).clientKeyAnalytics;
  expect(a.rows).toHaveLength(3);
  expect(a.rows.find(r => !r.clientKeyId).clientKeyName).toBe('Unknown');
  expect((await usage.getUsageStats('24h')).clientKeyAnalytics.recordCount).toBe(0);
  expect(JSON.stringify(a)).not.toContain('fixture-client');
});
const record = (extra = {}) => ({ timestamp: new Date().toISOString(), model: 'fixture-model', provider: 'fixture-provider', apiKey: 'fixture-client-a', connectionId: 'upstream-not-client', status: 'success', tokens: { prompt_tokens: 12, completion_tokens: 3 }, ...extra });
it('exposes client name and stable ID in REST and SSE, never the credential', async () => {
  await usage.saveRequestUsage(record());
  const stats = await usage.getUsageStats('all');
  const live = await usage.getActiveRequests();
  for (const result of [stats.recentRequests, live.recentRequests]) {
    expect(result[0]).toMatchObject({ clientKeyId: 'client-a', clientKeyName: 'Client Alpha' });
    expect(JSON.stringify(result)).not.toContain('fixture-client-a');
    expect(JSON.stringify(result)).not.toContain('upstream-not-client');
  }
  const row = db.get('SELECT meta FROM usageHistory');
  expect(JSON.parse(row.meta)).toMatchObject({ clientKeyId: 'client-a', clientKeyName: 'Client Alpha' });
});
