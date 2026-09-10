import { it, expect } from 'vitest';
import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import * as components from '../../src/shared/components/UsageStats.js';
it('offers explicit refresh with snapshot time and no SSE fetch loop', () => {
  const html = renderToStaticMarkup(React.createElement(components.ClientKeyAnalytics, { analytics: { rows: [], period: 'today' }, onRefresh: () => {}, snapshotAt: '2026-09-10T12:00:00.000Z', refreshing: true }));
  expect(html).toContain('Refresh analytics');
  expect(html).toContain('Snapshot');
  expect(html).toContain('2026-09-10T12:00:00.000Z');
  expect(html).toContain('disabled=""');
  const source = readFileSync(new URL('../../src/shared/components/UsageStats.js', import.meta.url), 'utf8');
  expect(source).toContain('onRefresh={() => setRefreshVersion(v => v + 1)}');
  expect(source).toContain('[period, refreshVersion]');
  const sse = source.split('// SSE connection')[1].split('const toggleSort')[0];
  expect(sse).not.toMatch(/fetch\(|setRefreshVersion/);
});
it('renders client key name in Recent Requests without a secret or false success', () => {
  expect(components.RecentRequests).toBeTypeOf('function');
  const html = renderToStaticMarkup(React.createElement(components.RecentRequests, { requests: [{ model: 'test', clientKeyName: 'Client <Alpha>', apiKey: 'do-not-render-fixture', timestamp: new Date().toISOString() }] }));
  expect(html).toContain('Client API key');
  expect(html).toContain('Client &lt;Alpha&gt;');
  expect(html).not.toMatch(/title="(success|error|unknown)"/);
  expect(html).not.toContain('do-not-render-fixture');
});
it('withholds outcome rates and renders honest scope and supported cost', () => {
  expect(components.ClientKeyAnalytics).toBeTypeOf('function');
  const analytics = { period: '24h', from: '2026-09-09T00:00:00Z', to: '2026-09-10T00:00:00Z', rows: [{ clientKeyId: 'a', clientKeyName: 'Alpha', requests: 2, promptTokens: 10, completionTokens: 5, successes: 1, errors: 0, unknown: 1, successRate: 50, errorRate: 0, cost: null, costSupportedRequests: 0 }] };
  const html = renderToStaticMarkup(React.createElement(components.ClientKeyAnalytics, { analytics }));
  for (const text of ['Client API key analytics', 'Retained history', '24h', 'Outcomes unavailable from recorded usage', 'not full attempts', 'Recorded usage']) expect(html).toContain(text);
  expect(html).not.toMatch(/>Success<|>Error<|>Unknown<|50.0%/);
  expect(html).not.toContain('Estimated cost');
  analytics.rows[0].cost = 0; analytics.rows[0].costSupportedRequests = 1;
  const priced = renderToStaticMarkup(React.createElement(components.ClientKeyAnalytics, { analytics }));
  expect(priced).toContain('Estimated cost');
  expect(priced).toContain('1/2 priced');
});
