/**
 * Quality Gate — проверяет качество результатов выполнения задач.
 * 
 * Использует модель (настраивается через UI оркестратора) для оценки:
 * 1. Корректность — соответствует ли результат запросу
 * 2. Полнота — всё ли выполнено
 * 3. Качество — стиль, читаемость, best practices
 * 
 * Если облачный API недоступен — использует Ollama для ревью,
 * или эвристическую проверку как последний фоллбэк.
 */

import { getSettings } from '@/lib/db/repos/settingsRepo.js';
import { fetchWithTimeout } from '@/shared/utils/fetchWithTimeout.js';
import { modelRouter } from './modelRouter.js';

function getOllamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');
}

const _hasCloudKey = () => !!(process.env.PROVIDER_ROUTERAI_KEY || '').trim();

class QualityGate {
  constructor() {
    this._settingsCache = null;
    this._settingsCacheTime = 0;
    this.minScore = 0.6;
  }

  async _getSettings() {
    if (this._settingsCache && Date.now() - this._settingsCacheTime < 30000) {
      return this._settingsCache;
    }
    try {
      const allSettings = await getSettings();
      const orch = allSettings.orchestrator || {};
      const useOllama = !_hasCloudKey() && !(orch.reviewApiKey || orch.supervisorApiKey);

      this._settingsCache = {
        endpoint: useOllama
          ? getOllamaBaseUrl()
          : (orch.reviewEndpoint || orch.supervisorEndpoint || 'https://routerai.ru').replace(/\/$/, ''),
        apiKey: orch.reviewApiKey || orch.supervisorApiKey || process.env.PROVIDER_ROUTERAI_KEY || '',
        model: orch.reviewModel || orch.supervisorModel || (useOllama ? 'auto' : 'deepseek/deepseek-v4-flash'),
        maxTokens: orch.reviewMaxTokens || 500,
        temperature: orch.reviewTemperature || 0.2,
        minScore: orch.minQualityScore || 0.6,
        useOllama
      };
      this.minScore = this._settingsCache.minScore;
      this._settingsCacheTime = Date.now();
      return this._settingsCache;
    } catch {
      const useOllama = !_hasCloudKey();
      return {
        endpoint: useOllama ? getOllamaBaseUrl() : 'https://routerai.ru',
        apiKey: process.env.PROVIDER_ROUTERAI_KEY || '',
        model: useOllama ? 'auto' : 'deepseek/deepseek-v4-flash',
        maxTokens: 500,
        temperature: 0.2,
        minScore: 0.6,
        useOllama
      };
    }
  }

  async review(plan, results, userRequest) {
    if (!results || results.length === 0) {
      return { passed: true, summary: 'Нет задач для проверки', score: 1.0, feedback: '' };
    }

    const taskReviews = await Promise.all(
      results.map(result => this._reviewTask(result, userRequest))
    );

    const avgScore = taskReviews.reduce((sum, r) => sum + r.score, 0) / taskReviews.length;
    const allPassed = taskReviews.every(r => r.passed);
    const failedTasks = taskReviews.filter(r => !r.passed);

    if (allPassed && avgScore >= this.minScore) {
      return {
        passed: true,
        summary: `✅ Все ${results.length} задач(и) выполнены успешно (средний балл: ${(avgScore * 100).toFixed(0)}%)`,
        score: avgScore,
        feedback: '',
        details: taskReviews
      };
    }

    const feedback = failedTasks.map((r, i) =>
      `Задача "${results[i]?.description || i}": ${r.feedback}`
    ).join('\n');

    return {
      passed: false,
      summary: `❌ ${failedTasks.length} из ${results.length} задач требуют доработки`,
      score: avgScore,
      feedback,
      details: taskReviews
    };
  }

  async _reviewTask(result, userRequest) {
    if (!result || result.status !== 'completed') {
      return { passed: false, score: 0, feedback: result?.error || 'Задача не выполнена', suggestions: ['Повторить выполнение задачи'] };
    }
    if (!result.result) {
      return { passed: false, score: 0.3, feedback: 'Результат пустой', suggestions: ['Убедиться что модель вернула ответ'] };
    }

    try {
      return await this._aiReview(result, userRequest);
    } catch {
      return this._heuristicReview(result);
    }
  }

  async _aiReview(result, userRequest) {
    const settings = await this._getSettings();
    const prompt = `Ты — Quality Gate, проверяешь качество ответа AI-модели.

Запрос пользователя: "${userRequest}"
Тип задачи: ${result.type || 'chat'}
Описание задачи: ${result.description || 'не указано'}

Результат (первые 1000 символов):
${(result.result || '').substring(0, 1000)}

Оцени результат по шкале 0.0 - 1.0.
Ответь строго в формате JSON:
{
  "score": 0.85,
  "passed": true,
  "feedback": "кратко что не так (если passed=false) или пустая строка",
  "suggestions": ["конкретное предложение по улучшению"]
}`;

    let response;
    if (settings.useOllama) {
      // Вызов через Ollama API
      const { modelRouter } = await import('./modelRouter.js');
      let model = settings.model;
      if (model === 'auto') {
        const firstModel = modelRouter.getFirstAvailableModel();
        model = firstModel?.id || 'llama3';
      }
      response = await fetchWithTimeout(`${settings.endpoint}/api/chat`, {
        method: 'POST',
        timeoutMs: 30_000,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'Ты — Quality Gate. Отвечай только в JSON формате.' },
            { role: 'user', content: prompt }
          ],
          stream: false,
          options: { temperature: settings.temperature, num_predict: settings.maxTokens }
        })
      });

      if (!response.ok) throw new Error(`Review Ollama error: ${response.status}`);
      const data = await response.json();
      const content = data.message?.content || '';
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
      } catch {}
      return this._heuristicReview(result);
    } else {
      // Вызов через OpenAI-совместимый API
      response = await fetchWithTimeout(`${settings.endpoint}/api/v1/chat/completions`, {
        method: 'POST',
        timeoutMs: 30_000,
        headers: {
          'Content-Type': 'application/json',
          ...(settings.apiKey ? { 'Authorization': `Bearer ${settings.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: settings.model,
          messages: [
            { role: 'system', content: 'Ты — Quality Gate. Отвечай только в JSON формате.' },
            { role: 'user', content: prompt }
          ],
          temperature: settings.temperature,
          max_tokens: settings.maxTokens,
          stream: false
        })
      });

      if (!response.ok) throw new Error(`Review model error: ${response.status}`);
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) return JSON.parse(jsonMatch[0]);
      } catch {}
      return this._heuristicReview(result);
    }
  }

  _heuristicReview(result) {
    const text = (result.result || '');
    const score = this._calculateHeuristicScore(text, result);
    return {
      score,
      passed: score >= this.minScore,
      feedback: score < this.minScore ? 'Эвристическая оценка ниже порога' : '',
      suggestions: score < this.minScore ? ['Проверить полноту и качество ответа'] : []
    };
  }

  _calculateHeuristicScore(text, result) {
    let score = 0.5;
    if (text.length < 50) score -= 0.3;
    else if (text.length < 200) score -= 0.1;
    else if (text.length > 500) score += 0.1;

    if (result.type === 'code') {
      if (text.includes('```')) score += 0.2;
      if (text.includes('function') || text.includes('const') || text.includes('import') || text.includes('def ')) score += 0.1;
    }

    if (/ошибк|error|failed|exception/i.test(text)) score -= 0.2;
    return Math.max(0, Math.min(1, score));
  }
}

export const qualityGate = new QualityGate();