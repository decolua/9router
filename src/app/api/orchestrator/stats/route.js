import { NextResponse } from 'next/server';
import { getAdapter } from '@/lib/db/driver.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

function extractLatency(meta) {
  if (!meta) return null;
  try { const m = typeof meta === 'string' ? JSON.parse(meta) : meta; return m.latencyMs != null ? m.latencyMs : null; } catch { return null; }
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString();
}

/**
 * GET /api/orchestrator/stats[?period=7d|30d|all]
 * Accumulated model health stats from usageHistory + ping records.
 */
export async function GET(request) {
  try {
    const { searchParams } = request.nextUrl;
    const period = searchParams.get('period') || '7d';
    const since = period === 'all' ? null : period === '30d' ? daysAgo(30) : daysAgo(7);

    const db = await getAdapter();
    const run = (sql, p = []) => typeof db.all === 'function' ? db.all(sql, p) : [];

    const rows = run(
      `SELECT model, provider, status, meta, timestamp, cost, promptTokens, completionTokens
       FROM usageHistory
       WHERE model IS NOT NULL AND model != ''${since ? ' AND timestamp >= ?' : ''}
       ORDER BY timestamp DESC`,
      since ? [since] : []
    );

    const agg = new Map();
    for (const r of rows) {
      const key = r.model;
      if (!agg.has(key)) agg.set(key, { model: key, provider: r.provider || 'unknown', pingResults: [], usageResults: [], pingSuccesses: 0, pingFailures: 0, usageOk: 0, usageError: 0, latencies: [], totalTokens: 0, totalCost: 0 });
      const e = agg.get(key);
      const latency = extractLatency(r.meta);
      const isPing = !r.cost && !r.promptTokens;
      if (isPing) {
        e.pingResults.push(r);
        if (r.status === 'ok') { e.pingSuccesses++; if (latency != null) e.latencies.push(latency); }
        else e.pingFailures++;
      } else {
        e.usageResults.push(r);
        if (r.status === 'ok') e.usageOk++; else e.usageError++;
        e.totalTokens += (r.promptTokens || 0) + (r.completionTokens || 0);
        e.totalCost += r.cost || 0;
      }
    }

    const models = Array.from(agg.values()).map(e => {
      const tp = e.pingSuccesses + e.pingFailures;
      const tu = e.usageOk + e.usageError;
      const pr = tp > 0 ? Math.round((e.pingSuccesses / tp) * 100) : null;
      const ur = tu > 0 ? Math.round((e.usageOk / tu) * 100) : null;
      const or = pr != null && ur != null ? Math.round((pr + ur) / 2) : pr ?? ur ?? 100;
      const lat = e.latencies.length > 0 ? Math.round(e.latencies.reduce((a, b) => a + b, 0) / e.latencies.length) : null;
      const speed = lat != null ? Math.max(0, Math.min(100, 100 - Math.floor((lat - 200) / 30))) : 50;
      const rel = or;
      const overall = Math.round(rel * 0.6 + speed * 0.4);
      return {
        model: e.model, provider: e.provider,
        pingStats: { total: tp, successes: e.pingSuccesses, failures: e.pingFailures, successRate: pr != null ? pr + '%' : null, avgLatencyMs: lat },
        usageStats: { total: tu, ok: e.usageOk, error: e.usageError, successRate: ur != null ? ur + '%' : null, totalTokens: e.totalTokens, totalCost: Math.round(e.totalCost * 10000) / 10000 },
        lastSeen: e.pingResults[0]?.timestamp || e.usageResults[0]?.timestamp,
        rating: { reliability: rel, speed, overall, tier: overall >= 90 ? 'A' : overall >= 75 ? 'B' : overall >= 50 ? 'C' : 'D' },
      };
    });

    models.sort((a, b) => {
      if (a.rating.tier !== b.rating.tier) return a.rating.tier.localeCompare(b.rating.tier);
      return b.rating.overall - a.rating.overall;
    });

    const summary = {
      period, totalModels: models.length,
      totalPings: rows.filter(r => !r.cost && !r.promptTokens).length,
      totalUsage: rows.filter(r => r.cost || r.promptTokens).length,
      totalTokens: models.reduce((s, m) => s + (m.usageStats?.totalTokens || 0), 0),
    };

    const recent = rows.slice(0, 30).map(r => ({
      model: r.model, provider: r.provider, status: r.status,
      timestamp: r.timestamp, latencyMs: extractLatency(r.meta),
      cost: r.cost || 0, tokens: (r.promptTokens || 0) + (r.completionTokens || 0),
      type: (!r.cost && !r.promptTokens) ? 'ping' : 'usage',
    }));

    return NextResponse.json({ status: 'ok', timestamp: new Date().toISOString(), summary, models, recent, lastUpdated: new Date().toISOString() });
  } catch (error) {
    console.error('[ModelStats] Error:', error);
    return NextResponse.json({ error: error.message || 'Internal server error', models: [], recent: [] }, { status: 500 });
  }
}
