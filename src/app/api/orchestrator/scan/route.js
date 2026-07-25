import { NextResponse } from 'next/server';
import { modelScanner } from '@/orchestrator/modelScanner.js';
import { updateSettings } from '@/lib/localDb.js';
import { getComboByName, updateCombo } from '@/lib/localDb.js';
import { getAdapter } from '@/lib/db/driver.js';
import { getCapabilitiesForModel } from 'open-sse/providers/capabilities.js';
import { cleanupBrokenModels } from '@/lib/cleanupBroken.js';

export const maxDuration = 300;

export async function POST() {
  try {
    const { models, config } = await modelScanner.scanAll();
    const ok = models.filter(m => m.status === 'ok');

    // Persist config to settings (restored on orchestrator GET)
    try {
      await updateSettings({
        modelScannerConfig: { ...config, timestamp: new Date().toISOString() },
      });
    } catch {}

    // Persist full scan results to SQLite
    try {
      const db = await getAdapter();
      const data = JSON.stringify({
        timestamp: new Date().toISOString(),
        summary: {
          total: models.length, ok: ok.length, failed: models.length - ok.length,
          topModel: config.supervisor?.model || null,
          topScore: config.supervisor?.score || 0,
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
          groups: Object.fromEntries(
            Object.entries(config.modelGroups || {}).map(([k, v]) => [k, {
              models: v.models?.map(m => ({ id: m.id, provider: m.provider, priority: m.priority, tier: m.tier })),
              strategy: v.strategy, fallbackModel: v.fallbackModel, enabled: v.enabled,
            }])
          ),
          supervisor: config.supervisor,
        },
      });
      if (typeof db.run === 'function') {
        db.run("INSERT OR REPLACE INTO kv(scope, key, value) VALUES('orchestrator', 'scanLastResults', ?)", [data]);
      }
    } catch {}

    // Auto-set supervisor from best model
    if (config.supervisor) {
      try {
        const { supervisor } = await import('@/orchestrator/supervisor.js');
        await supervisor.updateSettings({
          supervisorModel: config.supervisor.model,
          supervisorProvider: config.supervisor.provider,
        });
      } catch {}
    }

    // Update free-mix combo with all working models
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
              provider: m.provider, connectionId: m.connectionId, model: m.model,
              priority: Math.round((1 - (m.avgScore || 0)) * 10) + 1,
              contextWindow: caps?.contextWindow || 0,
              taskScore: {
                code: (m.scores?.code || 0), chat: (m.scores?.chat || 0), reasoning: (m.scores?.reasoning || 0),
              },
            };
          });
        await updateCombo(freeMix.id, { models: comboModels, kind: 'llm' });
      }
    } catch {}

    // Auto-cleanup broken models after scan
    try {
      const { disabled } = await cleanupBrokenModels();
      if (disabled.length > 0) {
        console.log(`[scan] 🧹 Автоочистка: отключено ${disabled.length} битых моделей`);
      }
    } catch {}

    console.log(`[scan] ✅ ${ok.length}/${models.length} моделей просканировано, лучшая: ${config.supervisor?.model || '—'}`);

    return NextResponse.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      summary: {
        total: models.length, ok: ok.length, failed: models.length - ok.length,
        topModel: config.supervisor?.model || null,
        topProvider: config.supervisor?.provider || null,
        topScore: config.supervisor?.score || 0,
      },
      models: models.map(m => ({
        model: m.model, provider: m.provider, connectionName: m.connectionName,
        status: m.status, avgScore: m.avgScore, latencyMs: m.latencyMs,
        tier: m.tier, costPer1K: m.costPer1K,
        capabilities: m.capabilities, scores: m.scores, error: m.error,
      })),
      config: {
        strategy: config.strategy,
        groups: Object.fromEntries(
          Object.entries(config.modelGroups).map(([k, v]) => [k, {
            enabled: v.enabled, strategy: v.strategy, models: v.models.map(m => m.id),
          }])
        ),
        preferFreeModels: config.switching.preferFreeModels,
        supervisor: config.supervisor,
      },
      ranking: config.ranking,
    });
  } catch (error) {
    console.error('[scan] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const db = await getAdapter();
    let lastResults = null;
    if (typeof db.get === 'function') {
      const row = db.get("SELECT value FROM kv WHERE scope=? AND key=?", ['orchestrator', 'scanLastResults']);
      if (row) lastResults = JSON.parse(row.value);
    }
    return NextResponse.json({
      status: 'ok',
      lastScan: lastResults,
      progress: modelScanner.getProgress(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
