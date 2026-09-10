import { it, expect } from 'vitest';
import { aggregateClientKeys } from '../../src/lib/clientKeyAnalytics.js';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ClientKeyAnalytics } from '../../src/shared/components/UsageStats.js';
it('handles empty, zero and unsupported cost denominators without NaN or false free costs', () => {
  expect(aggregateClientKeys([], [], 'all').totals.requests).toBe(0);
  const rows = aggregateClientKeys([{ meta: { clientKeyId: 'a', costSupported: true }, cost: 0 }, {}], [], 'all').rows;
  expect(rows[0]).toMatchObject({ inputTokenShare: 0, outputTokenShare: 0, costShare: 0 });
  expect(rows[1]).toMatchObject({ cost: null, costShare: null });
});
it('renders compact metric shares with denominator, coverage and OAuth estimate explanations', () => {
  const html = renderToStaticMarkup(React.createElement(ClientKeyAnalytics, { analytics: sample() }));
  for (const text of ['66.7%', '40.0%', '20.0%', '75.0%', 'including Unknown', 'known estimated-cost total', '2/3 records priced', 'API-equivalent', 'not a subscription charge']) expect(html).toContain(text);
});
const sample = () => aggregateClientKeys([
  { meta: { clientKeyId: 'a', costSupported: true }, promptTokens: 30, completionTokens: 10, cost: 3 },
  { meta: { clientKeyId: 'a' }, promptTokens: 10, completionTokens: 10, cost: 999 },
  { meta: { costSupported: true }, promptTokens: 60, completionTokens: 80, cost: 1 },
], [], 'today');
it('uses all retained matching records including Unknown as share denominators, excluding unpriced costs', () => {
  const a = sample();
  expect(a.totals).toMatchObject({ requests: 3, promptTokens: 100, completionTokens: 100, cost: 4, costSupportedRequests: 2 });
  expect(a.rows[0]).toMatchObject({ requestShare: 200 / 3, inputTokenShare: 40, outputTokenShare: 20, costShare: 75 });
  expect(a.rows[1]).toMatchObject({ requestShare: 100 / 3, inputTokenShare: 60, outputTokenShare: 80, costShare: 25 });
});
