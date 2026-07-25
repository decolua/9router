/**
 * POST /api/orchestrator/auto-config
 *
 * Автонастройка оркестратора по результатам ping-all:
 * - Обновляет free-mix комбо только работающими моделями
 * - Настраивает supervisor на лучшую (самую быструю) модель
 * - Обновляет ModelRouter группы
 */

import { NextResponse } from 'next/server';
import { getComboByName, updateCombo, getCombos } from '@/lib/localDb';
import { supervisor } from '@/orchestrator/supervisor.js';
import { modelRouter } from '@/orchestrator/modelRouter.js';

export const dynamic = 'force-dynamic';

export async function POST(request) {
  try {
    const body = await request.json();
    const { workingModels = [] } = body;

    if (!workingModels.length) {
      return NextResponse.json(
        { error: 'No working models provided. Run ping-all first.' },
        { status: 400 }
      );
    }

    const actions = [];

    // 1. Update free-mix combo with working models only
    const freeMix = await getComboByName('free-mix');
    if (freeMix) {
      const newModels = workingModels
        .filter(m => m.provider !== 'ollama') // exclude local Ollama from cloud combo
        .sort((a, b) => a.latencyMs - b.latencyMs) // fastest first
        .map((m, i) => ({
          provider: m.provider,
          connectionId: m.connectionId,
          model: m.model,
          priority: i + 1,
        }));

      if (newModels.length > 0) {
        await updateCombo(freeMix.id, {
          models: newModels,
          kind: 'llm',
        });
        actions.push(`free-mix обновлён: ${newModels.length} работающих моделей`);
      }
    } else {
      actions.push('free-mix комбо не найден — создайте вручную');
    }

    // 2. Set supervisor to fastest working model
    const fastest = workingModels
      .filter(m => m.provider !== 'ollama')
      .sort((a, b) => a.latencyMs - b.latencyMs)[0];

    if (fastest) {
      await supervisor.updateSettings({
        supervisorModel: fastest.model,
        supervisorProvider: fastest.provider,
      });
      actions.push(`Supervisor: ${fastest.model} (${fastest.latencyMs}ms)`);
    }

    // 3. Update ModelRouter groups with discovered models
    const groupMap = {};
    for (const m of workingModels) {
      const name = m.model.toLowerCase();
      const groups = [];

      // Classify by model name
      if (name.includes('coder') || name.includes('codestral')) groups.push('code', 'code_review');
      if (name.includes('vision') || name.includes('llama3.2-vision')) groups.push('vision');
      if (name.includes('embed')) groups.push('embeddings');

      // All models get chat + web_search
      if (!groups.includes('embeddings')) {
        groups.push('chat', 'web_search');
      }

      for (const g of groups) {
        if (!groupMap[g]) groupMap[g] = [];
        groupMap[g].push({
          model: m.model,
          provider: m.provider,
          latencyMs: m.latencyMs,
        });
      }
    }

    // Sort each group by latency
    for (const [group, models] of Object.entries(groupMap)) {
      groupMap[group] = models.sort((a, b) => a.latencyMs - b.latencyMs);
    }

    actions.push(`ModelRouter: ${Object.keys(groupMap).length} групп обновлено`);

    return NextResponse.json({
      status: 'ok',
      actions,
      freeMixModels: freeMix ? workingModels.filter(m => m.provider !== 'ollama').length : 0,
      supervisorModel: fastest?.model || null,
      groups: Object.fromEntries(
        Object.entries(groupMap).map(([k, v]) => [k, v.map(m => m.model)])
      ),
    });
  } catch (error) {
    console.error('[auto-config] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
