export function requestOutcome(status) {
  const value = String(status ?? '').toLowerCase();
  if (['ok', 'success'].includes(value) || /^2\d\d$/.test(value)) return 'success';
  if (['error', 'failed', 'failure'].includes(value) || /^[45]\d\d$/.test(value)) return 'error';
  return 'unknown';
}

export function aggregateClientKeys(history, keys, period) {
  const groups = new Map();
  for (const entry of history) {
    const identity = clientIdentity(entry, keys);
    const id = identity.clientKeyId;
    if (!groups.has(id)) groups.set(id, { ...identity, requests: 0, promptTokens: 0, completionTokens: 0, successes: 0, errors: 0, unknown: 0, cost: null, costSupportedRequests: 0 });
    const row = groups.get(id);
    row.requests++;
    row.promptTokens += entry.promptTokens || 0;
    row.completionTokens += entry.completionTokens || 0;
    if (entry.meta?.costSupported === true && Number.isFinite(entry.cost) && entry.cost >= 0) {
      row.cost = (row.cost || 0) + entry.cost;
      row.costSupportedRequests++;
    }
    const outcome = requestOutcome(entry.status);
    row[outcome === 'success' ? 'successes' : outcome === 'error' ? 'errors' : 'unknown']++;
  }
  const totals = { requests: history.length, promptTokens: 0, completionTokens: 0, cost: 0, costSupportedRequests: 0 };
  for (const row of groups.values()) {
    for (const field of ['promptTokens', 'completionTokens', 'cost', 'costSupportedRequests']) totals[field] += row[field] || 0;
  }
  const share = (value, total) => total > 0 ? 100 * value / total : 0;
  const rows = [...groups.values()].map(row => ({
    ...row,
    requestShare: share(row.requests, totals.requests),
    inputTokenShare: share(row.promptTokens, totals.promptTokens),
    outputTokenShare: share(row.completionTokens, totals.completionTokens),
    costShare: row.costSupportedRequests ? share(row.cost, totals.cost) : null,
    successRate: share(row.successes, row.requests), errorRate: share(row.errors, row.requests),
  }));
  const dates = history.map(r => r.timestamp).sort();
  return { scope: 'retained-history', period, totals, recordCount: history.length, from: dates[0] || null, to: dates.at(-1) || null, rows: rows.sort((a, b) => b.requests - a.requests) };
}

// Only public identity is returned. Never use upstream connection IDs or key prefixes.
export function clientIdentity(entry, keys) {
  const meta = entry.meta || {};
  const current = Object.prototype.hasOwnProperty.call(meta, "clientKeyId")
    ? keys.find(k => k.id === meta.clientKeyId)
    : keys.find(k => entry.apiKey && k.key === entry.apiKey);
  return {
    clientKeyId: current?.id || meta.clientKeyId || null,
    clientKeyName: current?.name || meta.clientKeyName || 'Unknown',
    clientKeyDeleted: !!meta.clientKeyId && !current,
  };
}
