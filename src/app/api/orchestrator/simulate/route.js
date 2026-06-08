/**
 * API Route: /api/orchestrator/simulate
 *
 * POST — симулировать выбор модели без реального запроса.
 * Позволяет тестировать логику modelRouter: round-robin, приоритеты,
 * cost-optimized, time-based rules, cooldown, лимиты и т.д.
 *
 * Все вызовы modelRouter защищены таймаутом и try-catch.
 */

import { NextResponse } from 'next/server';
import { modelRouter } from '@/orchestrator/modelRouter.js';
import { fetchWithTimeout } from '@/shared/utils/fetchWithTimeout.js';

/**
 * POST /api/orchestrator/simulate
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const { taskType, count = 1, options = {}, markUsage = false } = body;

    if (!taskType) {
      return NextResponse.json(
        { error: 'taskType is required (e.g., chat, code, vision)' },
        { status: 400 }
      );
    }

    // Проверяем, существует ли такая группа
    const config = modelRouter.getConfig();
    const group = config.modelGroups?.[taskType];
    if (!group) {
      return NextResponse.json(
        { error: `Group "${taskType}" not found in modelRouter config. Available: ${Object.keys(config.modelGroups || {}).join(', ')}` },
        { status: 400 }
      );
    }

    const iterations = Math.min(count, 50); // Лимит 50 итераций
    const results = [];
    const SELECT_TIMEOUT_MS = 10_000; // 10 sec per iteration

    for (let i = 0; i < iterations; i++) {
      // Используем getNextModel вместо несуществующего selectModel
      const selected = await Promise.race([
        (async () => {
          try {
            return modelRouter.getNextModel(taskType, {
              priority: options.priority || 1,
              estimatedTokens: options.estimatedTokens || 1000,
              taskType,
              ...options
            });
          } catch (err) {
            return { error: err.message };
          }
        })(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`selectModel timed out after ${SELECT_TIMEOUT_MS}ms`)), SELECT_TIMEOUT_MS)
        )
      ]);

      if (selected && !selected.error) {
        results.push({
          iteration: i + 1,
          modelId: selected.id,
          provider: selected.provider,
          priority: selected.priority,
          costPer1K: selected.costPer1K,
          maxTokens: selected.maxTokens,
          timestamp: new Date().toISOString()
        });

        // Опционально записываем использование для проверки лимитов
        if (markUsage && selected.id) {
          try {
            const simulatedCost = selected.costPer1K * (options.estimatedTokens || 1000) / 1000;
            // recordUsage(modelId, tokens, cost) — 3 аргумента
            modelRouter.recordUsage(
              selected.id,
              options.estimatedTokens || 1000,
              simulatedCost
            );
          } catch (err) {
            // Не фатально для симуляции
            console.error(`[Simulate] recordUsage failed: ${err.message}`);
          }
        }
      } else {
        results.push({
          iteration: i + 1,
          modelId: null,
          provider: null,
          error: selected?.error || 'No model selected (all unavailable or limit reached)',
          timestamp: new Date().toISOString()
        });
      }
    }

    // Получаем состояние после симуляции — используем существующие методы
    const stats = getSafeStats();
    const modelStatus = getModelStatusSafe();
    const rotationHistory = getRotationHistorySafe(20);

    return NextResponse.json({
      status: 'ok',
      taskType,
      iterations: results.length,
      config: {
        strategy: group.strategy || config.strategy,
        enabled: group.enabled !== false,
        fallbackModel: group.fallbackModel,
        modelsCount: (group.models || []).length,
        timeBasedRules: config.switching?.timeBasedRules || [],
        preferFreeModels: config.switching?.preferFreeModels ?? true,
        rotationIntervalMinutes: config.switching?.rotationIntervalMinutes ?? 10
      },
      models: (group.models || []).map(m => ({
        id: m.id,
        provider: m.provider,
        priority: m.priority,
        costPer1K: m.costPer1K,
        rateLimit: m.rateLimit || 0,
        cooldownMinutes: m.cooldownMinutes || 0
      })),
      selections: results,
      stats,
      health: modelStatus,
      rotationHistory: rotationHistory.slice(-20)
    });
  } catch (error) {
    console.error('[Orchestrator Simulate] POST error:', error);
    const status = error.message?.includes('timed out') ? 504 : 500;
    return NextResponse.json(
      { error: error.message || 'Simulation error' },
      { status }
    );
  }
}

/**
 * Безопасное получение статистики — все методы обёрнуты в try-catch
 */
function getSafeStats() {
  try {
    const raw = modelRouter.getStats();
    return {
      totalCost: raw?.dailyUsage?.totalCost ?? 0,
      totalTokens: raw?.dailyUsage?.totalTokens ?? 0,
      totalRequests: Object.values(raw?.dailyUsage?.requests || {}).reduce((a, b) => a + b, 0),
      globalLimitReached: false,
      hourlyCost: 0,
      costSpike: false,
      groupCost: 0,
      groupTokens: 0,
      groupCostLimited: false,
      groupTokenLimited: false
    };
  } catch (err) {
    return {
      totalCost: 0,
      totalTokens: 0,
      totalRequests: 0,
      globalLimitReached: false,
      hourlyCost: 0,
      costSpike: false,
      groupCost: 0,
      groupTokens: 0,
      groupCostLimited: false,
      groupTokenLimited: false,
      error: err.message
    };
  }
}

/**
 * Безопасное получение статуса моделей
 */
function getModelStatusSafe() {
  try {
    const status = {};
    const raw = modelRouter.getStats();
    const modelStatus = raw?.modelStatus || {};
    for (const [modelId, v] of Object.entries(modelStatus)) {
      status[modelId] = {
        available: v.available !== false,
        inCooldown: !!v.cooldownUntil && Date.now() < v.cooldownUntil,
        cooldownRemainingSec: v.cooldownUntil
          ? Math.max(0, Math.round((v.cooldownUntil - Date.now()) / 1000))
          : 0,
        lastUsed: v.lastUsed ? new Date(v.lastUsed).toISOString() : null,
        lastError: v.lastError || null,
        errorCount: 0
      };
    }
    return status;
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * Безопасное получение истории ротаций
 */
function getRotationHistorySafe(limit = 20) {
  try {
    const raw = modelRouter.getStats();
    return (raw?.rotationHistory || []).slice(-limit);
  } catch {
    return [];
  }
}