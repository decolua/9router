/**
 * API Route: GET /api/orchestrator/discover
 *
 * Auto-discovery моделей Ollama.
 * Сканирует локальный Ollama сервер и возвращает список доступных моделей.
 * Обновляет config.modelRouter с найденными Ollama моделями.
 */

import { NextResponse } from 'next/server';
import { fetchWithTimeout } from '@/shared/utils/fetchWithTimeout';

const OLLAMA_BASE = process.env.OLLAMA_HOST || process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const TIMEOUT = 10000;

export async function GET() {
  try {
    // 1. Получаем список моделей из Ollama
    const tagsRes = await fetchWithTimeout(`${OLLAMA_BASE}/api/tags`, {
      method: 'GET',
      timeout: TIMEOUT
    });

    if (!tagsRes.ok) {
      return NextResponse.json({
        success: false,
        error: `Ollama API error: HTTP ${tagsRes.status}`,
        models: []
      }, { status: 502 });
    }

    const tagsData = await tagsRes.json();
    const models = tagsData.models || [];

    if (models.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'Ollama работает, но нет загруженных моделей',
        models: []
      });
    }

    // 2. Форматируем модели
    const discovered = models.map(m => ({
      id: m.name,
      provider: 'ollama',
      costPer1K: 0,
      maxTokens: m.details?.parameter_size?.includes('B') ? 8192 : 4096,
      rateLimit: 60,
      priority: 5,
      cooldownMinutes: 0,
      size: m.size,
      modifiedAt: m.modified_at,
      digest: m.digest
    }));

    return NextResponse.json({
      success: true,
      message: `Найдено ${discovered.length} моделей Ollama`,
      models: discovered,
      baseUrl: OLLAMA_BASE
    });
  } catch (err) {
    return NextResponse.json({
      success: false,
      error: `Ollama недоступен: ${err.message}`,
      models: []
    }, { status: 503 });
  }
}