import { NextResponse } from 'next/server';
import {
  startBackgroundScanner,
  stopBackgroundScanner,
  isScannerRunning,
  getScannerStatus,
} from '@/orchestrator/backgroundScanner.js';
import { modelScanner } from '@/orchestrator/modelScanner.js';
import { getComboByName, updateCombo } from '@/lib/localDb.js';
import { updateSettings } from '@/lib/db/repos/settingsRepo.js';
import { getAdapter } from '@/lib/db/driver.js';
import { getCapabilitiesForModel } from 'open-sse/providers/capabilities.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    scanner: getScannerStatus(),
  });
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action || 'start';

    if (action === 'start') {
      if (isScannerRunning()) {
        return NextResponse.json({ status: 'ok', message: 'Scanner already running' });
      }

      const intervalMs = body.intervalMs || (10 * 60 * 1000);

      startBackgroundScanner({
        intervalMs,
        log: console,
        immediate: body.immediate !== false,
        onScan: async () => {
          const { models, config } = await modelScanner.scanAll();
          const ok = models.filter(m => m.status === 'ok');

          // Persist full scan results to SQLite
          await _persistScanResults(models, config);

          if (config.modelGroups) {
            try {
              await updateSettings({
                modelScannerConfig: {
                  strategy: config.strategy,
                  modelGroups: config.modelGroups,
                  switching: config.switching,
                  supervisor: config.supervisor,
                  timestamp: new Date().toISOString(),
                }
              });
            } catch {}
          }

          try {
            const freeMix = await getComboByName('free-mix');
            if (freeMix) {
              const comboModels = ok
                .sort((a, b) => {
                  if (a.tier !== b.tier) return a.tier === 'free' ? -1 : 1;
                  return (b.avgScore || 0) - (a.avgScore || 0);
                })
                .map(m => {
                  const caps = getCapabilitiesForModel(m.provider, m.model);
                  return {
                    provider: m.provider,
                    connectionId: m.connectionId,
                    model: m.model,
                    priority: Math.round((1 - (m.avgScore || 0)) * 10) + 1,
                    contextWindow: caps?.contextWindow || 0,
                    taskScore: {
                      code: (m.scores?.code || 0),
                      chat: (m.scores?.chat || 0),
                      reasoning: (m.scores?.reasoning || 0),
                    },
                  };
                });
              await updateCombo(freeMix.id, { models: comboModels, kind: 'llm' });
            }
          } catch {}

          return { ok: ok.length, total: models.length };
        },
      });

      return NextResponse.json({ status: 'ok', message: 'Background scanner started', scanner: getScannerStatus() });
    }

    if (action === 'stop') {
      stopBackgroundScanner();
      return NextResponse.json({ status: 'ok', message: 'Background scanner stopped', scanner: getScannerStatus() });
    }

    if (action === 'run-now') {
      const { models, config } = await modelScanner.scanAll();
      const ok = models.filter(m => m.status === 'ok');

      // Persist full scan results to SQLite
      await _persistScanResults(models, config);

      return NextResponse.json({
        status: 'ok',
        message: `Scan completed: ${ok.length}/${models.length} ok`,
        summary: { total: models.length, ok: ok.length, failed: models.length - ok.length },
      });
    }

    return NextResponse.json({ status: 'ok', scanner: getScannerStatus() });
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}

async function _persistScanResults(models, config) {
  try {
    const ok = models.filter(m => m.status === 'ok');
    const db = await getAdapter();
    const data = JSON.stringify({
      timestamp: new Date().toISOString(),
      summary: {
        total: models.length,
        ok: ok.length,
        failed: models.length - ok.length,
        topModel: ok.sort((a, b) => b.avgScore - a.avgScore)[0]?.model || null,
        topScore: ok.sort((a, b) => b.avgScore - a.avgScore)[0]?.avgScore || 0,
      },
      ranking: ok.map(m => ({
        model: m.model, provider: m.provider,
        avgScore: m.avgScore, latencyMs: m.latencyMs,
        tier: m.tier, capabilities: m.capabilities,
        scores: m.scores, costPer1K: m.costPer1K,
      })),
      config: {
        strategy: config.strategy,
        preferFreeModels: config.switching?.preferFreeModels,
        supervisor: config.supervisor,
      },
    });
    if (typeof db.run === 'function') {
      db.run("INSERT OR REPLACE INTO kv(scope, key, value) VALUES('orchestrator', 'scanLastResults', ?)", [data]);
    }
  } catch { /* not fatal */ }
}
