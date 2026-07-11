/**
 * API Route: /api/orchestrator
 *
 * Multi-agent orchestrator endpoint.
 * POST  — запустить workflow (отправить запрос на выполнение)
 * GET   — получить статус оркестратора, настройки, активные workflow + ModelRouter stats
 * PUT   — обновить настройки оркестратора и/или ModelRouter
 */

import { NextResponse } from 'next/server';
import { supervisor } from '@/orchestrator/supervisor.js';
import { modelRouter } from '@/orchestrator/modelRouter.js';
import { updateSettings, getSettings } from '@/lib/localDb.js';
import { getAdapter } from '@/lib/db/driver.js';
import { startBackgroundScanner, getScannerStatus } from '@/orchestrator/backgroundScanner.js';
import { modelScanner } from '@/orchestrator/modelScanner.js';
import { getComboByName, updateCombo } from '@/lib/localDb.js';
import { getCapabilitiesForModel } from 'open-sse/providers/capabilities.js';

/**
 * POST /api/orchestrator
 * Запуск нового workflow с таймаутом 5 минут
 */
export async function POST(request) {
  const REQUEST_TIMEOUT_MS = 5 * 60 * 1000; // 5 min

  try {
    const body = await request.json();
    const { userRequest, options = {} } = body;

    if (!userRequest || typeof userRequest !== 'string' || !userRequest.trim()) {
      return NextResponse.json(
        { error: 'userRequest is required and must be a non-empty string' },
        { status: 400 }
      );
    }

    // Execute with timeout to prevent hanging requests
    const workflow = await Promise.race([
      supervisor.processRequest(userRequest.trim(), options),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Orchestrator request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`)), REQUEST_TIMEOUT_MS)
      )
    ]);

    return NextResponse.json({
      status: 'ok',
      workflowId: workflow.id,
      workflow: {
        id: workflow.id,
        status: workflow.status,
        plan: workflow.plan,
        tasks: workflow.tasks?.map(t => ({
          id: t.id,
          type: t.type,
          description: t.description,
          status: t.status,
          result: t.result,
          error: t.error
        })),
        result: workflow.result,
        error: workflow.error,
        createdAt: workflow.createdAt,
        completedAt: workflow.completedAt
      }
    });
  } catch (error) {
    console.error('[Orchestrator] POST error:', error);
    const status = error.message?.includes('timed out') ? 504 : 500;
    return NextResponse.json(
      { error: error.message || 'Internal server error', code: status === 504 ? 'TIMEOUT' : 'ERROR' },
      { status }
    );
  }
}

/**
 * GET /api/orchestrator
 * Получить статус оркестратора, настройки, ModelRouter stats и конфигурацию
 */
export async function GET() {
  try {
    // Auto-start background scanner if not running (lazy init on first dashboard load)
    try {
      const bgStatus = getScannerStatus();
      if (!bgStatus.scheduled && !bgStatus.running) {
        startBackgroundScanner({
          intervalMs: 10 * 60 * 1000,
          log: console,
          immediate: false,
          onScan: async () => {
            const { models, config } = await modelScanner.scanAll();
            const ok = models.filter(m => m.status === 'ok');

            if (config.modelGroups) {
              try { await updateSettings({ modelScannerConfig: { ...config, timestamp: new Date().toISOString() } }); } catch {}
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
                      provider: m.provider, connectionId: m.connectionId, model: m.model,
                      priority: Math.round((1 - (m.avgScore || 0)) * 10) + 1,
                      contextWindow: caps?.contextWindow || 0,
                      taskScore: { code: (m.scores?.code || 0), chat: (m.scores?.chat || 0), reasoning: (m.scores?.reasoning || 0) },
                    };
                  });
                await updateCombo(freeMix.id, { models: comboModels, kind: 'llm' });
              }
            } catch {}
            return { ok: ok.length, total: models.length };
          },
        });
        console.log('[orchestrator] Background scanner auto-started');
      }
    } catch (e) {
      console.warn('[orchestrator] Background scanner init skipped:', e.message);
    }

    const settings = await supervisor.getEffectiveSettings();
    const activeWorkflows = supervisor.getActiveWorkflows();
    const allWorkflows = supervisor.getAllWorkflows();

    // Восстанавливаем routerAI из постоянного хранилища (переживает рестарты)
    try {
      const dbSettings = await getSettings();
      if (dbSettings.routerAI && typeof dbSettings.routerAI === 'object') {
        modelRouter.updateConfig({ routerAI: dbSettings.routerAI });
      }
    } catch (e) {
      // не фатально — используем дефолты
    }

    // Восстанавливаем полную конфигурацию ModelRouter после сканирования
    try {
      const dbSettings = await getSettings();
      if (dbSettings.modelScannerConfig && typeof dbSettings.modelScannerConfig === 'object') {
        const saved = dbSettings.modelScannerConfig;
        if (saved.modelGroups) {
          modelRouter.updateConfig({
            strategy: saved.strategy,
            modelGroups: saved.modelGroups,
            switching: saved.switching,
          });

          // Populate _scannerCache so getBestFreeModel works immediately
          const allModels = [];
          for (const group of Object.values(saved.modelGroups)) {
            for (const m of (group.models || [])) {
              allModels.push({
                model: m.id, provider: m.provider,
                tier: m.tier || (m.costPer1K === 0 ? 'free' : 'paid'),
                avgScore: m.priority ? Math.max(0, 1 - (m.priority - 1) / 10) : 0.5,
                costPer1K: m.costPer1K || 0,
              });
            }
          }
          if (allModels.length > 0) {
            modelRouter.setScannerResults(allModels.map(m => ({
              ...m, status: 'ok',
              scores: { chat: m.avgScore },
              capabilities: ['chat'],
            })));
          }
        }
      }
    } catch (e) {
      // не фатально
    }

    const modelConfig = modelRouter.getConfig();

    // Load last ping results from SQLite
    let lastPingResults = null;
    try {
      const db = await getAdapter();
      if (typeof db.get === 'function') {
        const row = db.get("SELECT value FROM kv WHERE scope=? AND key=?", ['orchestrator', 'pingLastResults']);
        if (row) lastPingResults = JSON.parse(row.value);
      }
    } catch { /* not fatal */ }

    // Load last scan results from SQLite
    let lastScanResults = null;
    try {
      const db = await getAdapter();
      if (typeof db.get === 'function') {
        const row = db.get("SELECT value FROM kv WHERE scope=? AND key=?", ['orchestrator', 'scanLastResults']);
        if (row) {
          const raw = JSON.parse(row.value);
          // Normalize old format (models array) to new format (summary/ranking)
          if (raw.models && !raw.summary) {
            raw.summary = {
              total: raw.models?.length || 0,
              ok: raw.models?.filter(m => m.status === 'ok')?.length || 0,
              failed: raw.models?.filter(m => m.status !== 'ok')?.length || 0,
              topModel: raw.config?.supervisor?.model || null,
              topScore: raw.config?.supervisor?.score || 0,
            };
            raw.ranking = (raw.models || [])
              .filter(m => m.status === 'ok')
              .map(m => ({
                model: m.model, provider: m.provider,
                avgScore: m.avgScore, latencyMs: m.latencyMs,
                tier: m.tier, capabilities: m.capabilities,
                scores: m.scores, costPer1K: m.costPer1K,
              }));
          }
          lastScanResults = raw;
        }
      }
    } catch { /* not fatal */ }

    // Feed ping results into modelRouter health status for dashboard Health Check
    if (lastPingResults?.workingModels) {
      for (const m of lastPingResults.workingModels) {
        modelRouter.markModelAvailable(m.model);
      }
      for (const r of lastPingResults.results || []) {
        if (r.status !== 'ok') {
          modelRouter.markModelUnavailable(r.model, r.error);
        }
      }
    }

    // Get stats AFTER feeding ping results
    const modelStats = modelRouter.getStats();

    // Map modelStatus → modelHealth for dashboard compatibility
    const modelHealth = modelStats.modelStatus || {};

    return NextResponse.json({
      status: 'enabled',
      activeWorkflows: activeWorkflows.length,
      totalWorkflows: allWorkflows.length,
      lastPingResults,
      lastScanResults,
      supervisorModel: settings.supervisorModel,
      supervisorEndpoint: settings.supervisorEndpoint,
      settings: {
        supervisorProvider: settings.supervisorProvider,
        supervisorModel: settings.supervisorModel,
        supervisorEndpoint: settings.supervisorEndpoint,
        supervisorMaxTokens: settings.supervisorMaxTokens,
        supervisorTemperature: settings.supervisorTemperature,
        reviewProvider: settings.reviewProvider,
        reviewModel: settings.reviewModel,
        reviewEndpoint: settings.reviewEndpoint,
        reviewMaxTokens: settings.reviewMaxTokens,
        reviewTemperature: settings.reviewTemperature,
        maxRetries: settings.maxRetries,
        minQualityScore: settings.minQualityScore
      },
      modelRouter: {
        config: modelConfig,
        stats: { ...modelStats, modelHealth },
      },
      workflows: allWorkflows.map(w => ({
        id: w.id,
        status: w.status,
        userRequest: w.userRequest?.substring(0, 200),
        taskCount: w.tasks?.length || 0,
        createdAt: w.createdAt,
        completedAt: w.completedAt
      }))
    });
  } catch (error) {
    console.error('[Orchestrator] GET error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/orchestrator
 * Обновить настройки оркестратора и/или ModelRouter конфигурацию
 */
export async function PUT(request) {
  try {
    const body = await request.json();

    // Валидация: хотя бы одно поле для обновления
    if (!body || Object.keys(body).length === 0) {
      return NextResponse.json(
        { error: 'At least one setting field is required' },
        { status: 400 }
      );
    }

    // Допустимые поля для обновления оркестратора
    const allowedKeys = [
      'supervisorProvider',
      'supervisorModel',
      'supervisorApiKey',
      'supervisorEndpoint',
      'supervisorMaxTokens',
      'supervisorTemperature',
      'reviewProvider',
      'reviewModel',
      'reviewApiKey',
      'reviewEndpoint',
      'reviewMaxTokens',
      'reviewTemperature',
      'maxRetries',
      'minQualityScore'
    ];

    // Обновляем настройки оркестратора если есть
    let newSettings = null;
    const orchUpdates = {};
    for (const key of allowedKeys) {
      if (key in body) {
        orchUpdates[key] = body[key];
      }
    }
    if (Object.keys(orchUpdates).length > 0) {
      newSettings = await supervisor.updateSettings(orchUpdates);
    }

    // Обновляем ModelRouter конфиг если передан целиком
    if (body.modelRouter) {
      modelRouter.updateConfig(body.modelRouter);
    }

    // Обновляем отдельные поля ModelRouter (плоские)
    const modelRouterDirectFields = [
      'strategy', 'globalCostLimitPerDay', 'globalTokenLimitPerDay'
    ];
    const modelRouterUpdates = {};
    for (const key of modelRouterDirectFields) {
      if (key in body) {
        modelRouterUpdates[key] = body[key];
      }
    }

    // Обновляем switching настройки
    const modelRouterSwitchingFields = [
      'enabled', 'cooldownMinutes', 'preferFreeModels', 'minCostDiff',
      'respectRateLimits', 'maxConsecutiveFreeRequests', 'rotationIntervalMinutes',
      'smartRotation', 'timeBasedRules'
    ];
    for (const key of modelRouterSwitchingFields) {
      if (key in body) {
        if (!modelRouterUpdates.switching) modelRouterUpdates.switching = {};
        modelRouterUpdates.switching[key] = body[key];
      }
    }

    // Обновляем routerAI настройки
    const routerAIFields = [
      'enabled', 'manageFreeModels', 'includeOllama', 'freeModelTimeout',
      'maxFreeModelsPerGroup', 'freeModelCooldownSeconds', 'autoEnableAfterError'
    ];
    for (const key of routerAIFields) {
      if (key in body) {
        if (!modelRouterUpdates.routerAI) modelRouterUpdates.routerAI = {};
        modelRouterUpdates.routerAI[key] = body[key];
      }
    }

    // Обновляем rateLimiting настройки
    const rateLimitingFields = [
      'enabled', 'globalRequestsPerMinute', 'perModelRequestsPerMinute',
      'burstLimit', 'retryAfterOnLimit'
    ];
    for (const key of rateLimitingFields) {
      if (key in body) {
        if (!modelRouterUpdates.rateLimiting) modelRouterUpdates.rateLimiting = {};
        modelRouterUpdates.rateLimiting[key] = body[key];
      }
    }

    // Обновляем scheduling настройки
    const schedulingFields = [
      'enabled', 'timezone', 'peakHours', 'peakHourCostMultiplier',
      'offPeakStrategy', 'weekendStrategy'
    ];
    for (const key of schedulingFields) {
      if (key in body) {
        if (!modelRouterUpdates.scheduling) modelRouterUpdates.scheduling = {};
        modelRouterUpdates.scheduling[key] = body[key];
      }
    }

    // Обновляем monitoring настройки
    const monitoringFields = [
      'enabled', 'logRotations', 'logErrors', 'alertOnCostSpike',
      'costSpikeThreshold', 'logLevel'
    ];
    for (const key of monitoringFields) {
      if (key in body) {
        if (!modelRouterUpdates.monitoring) modelRouterUpdates.monitoring = {};
        modelRouterUpdates.monitoring[key] = body[key];
      }
    }

    // Сохраняем routerAI в постоянное хранилище (SQLite/Settings)
    if (modelRouterUpdates.routerAI) {
      try {
        await updateSettings({ routerAI: modelRouterUpdates.routerAI });
      } catch (e) {
        console.error('[Orchestrator] Failed to persist routerAI settings:', e.message);
      }
    }

    // Применяем все накопленные обновления ModelRouter
    if (Object.keys(modelRouterUpdates).length > 0) {
      modelRouter.updateConfig(modelRouterUpdates);
    }

    // Обновление modelGroups (если передана)
    if (body.modelGroupUpdates && typeof body.modelGroupUpdates === 'object') {
      for (const [groupName, groupConfig] of Object.entries(body.modelGroupUpdates)) {
        const update = {};
        update[groupName] = groupConfig;
        modelRouter.updateConfig({ modelGroups: update });
      }
    }

    // Сброс статистики (если запрошено)
    if (body.resetStats) {
      modelRouter.resetAll();
    }

    const finalConfig = modelRouter.getConfig();

    return NextResponse.json({
      status: 'ok',
      message: 'Settings updated',
      settings: newSettings,
      modelRouter: {
        config: finalConfig,
        stats: modelRouter.getStats()
      }
    });
  } catch (error) {
    console.error('[Orchestrator] PUT error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Helper to abort long-running requests via setTimeout + AbortController.
 * Used internally by orchestrator routes for additional safety.
 * @param {number} ms
 * @returns {{ signal: AbortSignal, clear: () => void }}
 */
function createRouteTimeout(ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`route timeout after ${ms}ms`)), ms);
  timer.unref?.();
  return {
    signal: ctrl.signal,
    clear: () => { clearTimeout(timer); }
  };
}
