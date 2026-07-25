/**
 * Supervisor Agent — старшая модель, которая:
 * 1. Принимает запрос пользователя
 * 2. Планирует какие подзадачи нужно выполнить
 * 3. Делегирует их агентам через TaskRouter
 * 4. Собирает результаты
 * 5. Проверяет качество через QualityGate
 * 6. При необходимости отправляет на доработку
 * 
 * Старшая модель может использовать любой OpenAI-совместимый API
 * (по умолчанию — DeepSeek через RouterAI) и управляет всеми
 * остальными моделями.
 * 
 * Если облачных ключей нет — автоматически использует Ollama
 * для планирования и ревью (полностью локальная работа).
 * 
 * Настройки хранятся в БД (settings table) и могут быть изменены
 * через UI дашборда оркестратора.
 */

import { v4 as uuidv4 } from 'uuid';
import { taskRouter } from './taskRouter.js';
import { qualityGate } from './qualityGate.js';
import { agentPool } from './agentPool.js';
import { modelRouter } from './modelRouter.js';
import { getSettings, updateSettings } from '@/lib/db/repos/settingsRepo.js';
import { fetchWithTimeout } from '@/shared/utils/fetchWithTimeout.js';
import {
  hasOpenCodeGoKey,
  getRecommendedModel,
  getEndpoint,
  getHeaders,
  callOpenCodeModel,
} from './opencodeConnect.js';
import { getAdapter } from '@/lib/db/driver.js';
import { stringifyJson, parseJson } from '@/lib/db/helpers/jsonCol.js';

/**
 * Получить Ollama base URL из env
 */
function getOllamaBaseUrl() {
  return (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');
}

// Типы задач, которые может планировать Supervisor
export const TASK_TYPES = {
  VISION: 'vision',
  CODE: 'code',
  CODE_REVIEW: 'code_review',
  CHAT: 'chat',
  WEB_SEARCH: 'web_search',
  EMBEDDINGS: 'embeddings',
  IMAGE_GEN: 'image_gen',
  ORCHESTRATE: 'orchestrate'
};

// Состояния задач
export const TASK_STATUS = {
  PENDING: 'pending',
  PLANNING: 'planning',
  IN_PROGRESS: 'in_progress',
  REVIEWING: 'reviewing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  NEEDS_REWORK: 'needs_rework'
};

// Определяем доступен ли облачный провайдер
const _hasCloudKey = () => !!(process.env.PROVIDER_ROUTERAI_KEY || '').trim();

// Настройки по умолчанию — автоопределение: облако или Ollama
export const DEFAULT_ORCHESTRATOR_SETTINGS = {
  supervisorProvider: _hasCloudKey() ? 'routerai' : 'ollama',
  supervisorModel: _hasCloudKey() ? 'deepseek/deepseek-v4-flash' : 'auto',
  supervisorApiKey: process.env.PROVIDER_ROUTERAI_KEY || '',
  supervisorEndpoint: _hasCloudKey() ? 'https://routerai.ru' : getOllamaBaseUrl(),
  supervisorMaxTokens: 2000,
  supervisorTemperature: 0.3,
  reviewProvider: _hasCloudKey() ? 'routerai' : 'ollama',
  reviewModel: _hasCloudKey() ? 'deepseek/deepseek-v4-flash' : 'auto',
  reviewApiKey: process.env.PROVIDER_ROUTERAI_KEY || '',
  reviewEndpoint: _hasCloudKey() ? 'https://routerai.ru' : getOllamaBaseUrl(),
  reviewMaxTokens: 500,
  reviewTemperature: 0.2,
  maxRetries: 3,
  minQualityScore: 0.6
};

class Supervisor {
  constructor() {
    this.tasks = new Map();
    this.workflows = new Map();
    this.listeners = new Set();
    this._settingsCache = null;
    this._settingsCacheTime = 0;

    // ---- Crash prevention ----
    this.WORKFLOW_TTL_MS = 24 * 60 * 60 * 1000;
    this.MAX_TASKS_PER_WORKFLOW = 100;
    this.TASK_TIMEOUT_MS = 120_000;
    this.SUPERVISOR_TIMEOUT_MS = 30_000;

    this._cleanupInterval = setInterval(() => this._cleanupStaleWorkflows(), 5 * 60 * 1000);
    this._cleanupInterval.unref();

    console.log(`[Supervisor] initialized — provider: ${DEFAULT_ORCHESTRATOR_SETTINGS.supervisorProvider}, crash prevention guards active`);
  }

  async _getSettings() {
    if (this._settingsCache && Date.now() - this._settingsCacheTime < 30000) {
      return this._settingsCache;
    }
    try {
      const allSettings = await getSettings();
      const orchSettings = {
        ...DEFAULT_ORCHESTRATOR_SETTINGS,
        ...(allSettings.orchestrator || {})
      };
      // Авто-детект: если ключи пустые — Ollama
      if (!orchSettings.supervisorApiKey && orchSettings.supervisorProvider === 'routerai') {
        orchSettings.supervisorProvider = 'ollama';
        orchSettings.supervisorEndpoint = getOllamaBaseUrl();
        orchSettings.supervisorModel = 'auto';
      }
      if (!orchSettings.reviewApiKey && orchSettings.reviewProvider === 'routerai') {
        orchSettings.reviewProvider = 'ollama';
        orchSettings.reviewEndpoint = getOllamaBaseUrl();
        orchSettings.reviewModel = 'auto';
      }

      // Динамический выбор бесплатной модели, если supervisorModel == 'auto'
      // или если в настройках есть модель, но это платная, а есть free
      if (orchSettings.supervisorModel === 'auto' || orchSettings.supervisorModel === 'deepseek/deepseek-v4-flash') {
        const bestFree = modelRouter.getBestFreeModel('chat');
        if (bestFree) {
          orchSettings.supervisorProvider = bestFree.provider || 'opencode';
          orchSettings.supervisorModel = bestFree.id;
          orchSettings.supervisorApiKey = '';
          orchSettings.supervisorEndpoint = orchSettings.supervisorEndpoint || 'https://opencode.ai/zen/v1';
          console.log(`[Supervisor] Auto-selected free supervisor model: ${bestFree.provider}/${bestFree.id}`);
        }
      }

      // То же для review модели
      if (orchSettings.reviewModel === 'auto' || orchSettings.reviewModel === 'deepseek/deepseek-v4-flash') {
        const bestFreeReview = modelRouter.getBestFreeModel('code_review') || modelRouter.getBestFreeModel('chat');
        if (bestFreeReview) {
          orchSettings.reviewProvider = bestFreeReview.provider || 'opencode';
          orchSettings.reviewModel = bestFreeReview.id;
          orchSettings.reviewApiKey = '';
          orchSettings.reviewEndpoint = orchSettings.reviewEndpoint || 'https://opencode.ai/zen/v1';
          console.log(`[Supervisor] Auto-selected free review model: ${bestFreeReview.provider}/${bestFreeReview.id}`);
        }
      }

      this._settingsCache = orchSettings;
      this._settingsCacheTime = Date.now();
      return orchSettings;
    } catch {
      return { ...DEFAULT_ORCHESTRATOR_SETTINGS };
    }
  }

  async updateSettings(newSettings) {
    try {
      const allSettings = await getSettings();
      const currentOrch = allSettings.orchestrator || {};
      const merged = { ...currentOrch, ...newSettings };
      await updateSettings({ ...allSettings, orchestrator: merged });
      this._settingsCache = null;
      this._settingsCacheTime = 0;
      return merged;
    } catch (err) {
      console.error(`[Supervisor] updateSettings failed: ${err.message}`);
      return this._settingsCache || { ...DEFAULT_ORCHESTRATOR_SETTINGS };
    }
  }

  async getEffectiveSettings() {
    return await this._getSettings();
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  _notify(event, data) {
    for (const cb of this.listeners) {
      try { cb(event, data); } catch {}
    }
  }

  async processRequest(userRequest, options = {}) {
    const workflowId = uuidv4();
    const workflow = {
      id: workflowId,
      userRequest,
      tasks: [],
      status: TASK_STATUS.PENDING,
      createdAt: Date.now(),
      completedAt: null,
      result: null,
      error: null,
      options
    };
    this.workflows.set(workflowId, workflow);
    this._notify('workflow:created', workflow);

    try {
      workflow.status = TASK_STATUS.PLANNING;
      this._notify('workflow:planning', workflow);
      const plan = await this._planTasks(userRequest, options);
      workflow.plan = plan;

      workflow.status = TASK_STATUS.IN_PROGRESS;
      this._notify('workflow:in_progress', workflow);

      const results = [];
      for (const taskDef of plan.tasks) {
        const task = await this._executeTask(taskDef, workflowId);
        results.push(task);
        workflow.tasks.push(task);
        this._notify('workflow:task_completed', { workflowId, task });
      }

      workflow.status = TASK_STATUS.REVIEWING;
      this._notify('workflow:reviewing', workflow);

      const review = await qualityGate.review(plan, results, userRequest);
      const settings = await this._getSettings();

      if (!review.passed && this._canRetry(workflow, settings)) {
        workflow.retryCount = (workflow.retryCount || 0) + 1;
        workflow.status = TASK_STATUS.NEEDS_REWORK;
        this._notify('workflow:needs_rework', { workflow, review });
        return this._rework(workflow, review);
      }

      workflow.status = TASK_STATUS.COMPLETED;
      workflow.completedAt = Date.now();
      workflow.result = this._buildFinalResult(plan, results, review);
      this._notify('workflow:completed', workflow);
      return workflow;
    } catch (error) {
      workflow.status = TASK_STATUS.FAILED;
      workflow.error = error.message;
      this._notify('workflow:failed', workflow);
      throw error;
    }
  }

  async _planTasks(userRequest, options) {
    const prompt = this._buildPlanningPrompt(userRequest, options);
    const response = await this._callSupervisor(prompt);
    return this._parsePlan(response, userRequest);
  }

  _buildPlanningPrompt(userRequest, options) {
    return `Ты — Supervisor Agent, старшая модель в системе мульти-агентной оркестрации.
Твоя задача — проанализировать запрос пользователя и разбить его на подзадачи.

Доступные типы задач:
- vision — анализ изображений
- code — написание, рефакторинг, отладка кода
- code_review — ревью существующего кода
- chat — обычный текстовый диалог
- web_search — поиск информации в интернете
- embeddings — создание эмбеддингов
- image_gen — генерация изображений

Запрос пользователя: "${userRequest}"

${options.context ? `Дополнительный контекст: ${options.context}` : ''}

Ответь строго в формате JSON (без markdown, без пояснений):
{
  "tasks": [
    {
      "type": "vision|code|chat|web_search|embeddings|image_gen",
      "description": "краткое описание подзадачи",
      "dependsOn": [],
      "priority": 1,
      "model_hint": "auto"
    }
  ],
  "reasoning": "краткое обоснование плана на русском"
}`;
  }

  /**
   * Вызывает старшую модель через Ollama, OpenCode или OpenAI-совместимый API
   */
  async _callSupervisor(prompt) {
    const settings = await this._getSettings();
    const hasOpenCodeGoKey = process.env.PROVIDER_OPENCODE_KEY && process.env.PROVIDER_OPENCODE_KEY.trim();
    
    const isOllama = settings.supervisorProvider === 'ollama' || !settings.supervisorApiKey;
    const endpoint = (settings.supervisorEndpoint || DEFAULT_ORCHESTRATOR_SETTINGS.supervisorEndpoint).replace(/\/$/, '');
    const apiKey = settings.supervisorApiKey;
    let model = settings.supervisorModel || DEFAULT_ORCHESTRATOR_SETTINGS.supervisorModel;
    const maxTokens = settings.supervisorMaxTokens || DEFAULT_ORCHESTRATOR_SETTINGS.supervisorMaxTokens;
    const temperature = settings.supervisorTemperature ?? DEFAULT_ORCHESTRATOR_SETTINGS.supervisorTemperature;

    // OpenCode Go предпочтительнее Ollama для Supervisor (если есть ключ)
    if (!isOllama && model === 'auto' && hasOpenCodeGoKey) {
      const recommended = getRecommendedModel('chat', { complexity: 'high', requiresQuality: true }, true);
      if (recommended) {
        model = recommended.model;
        console.log(`[Supervisor] Auto-selected OpenCode Go model: ${model}`);
      }
    }

    // Ollama + auto → первая доступная модель
    if (isOllama && (model === 'auto' || !model)) {
      const firstModel = modelRouter.getFirstAvailableModel();
      if (firstModel) {
        model = firstModel.id;
        console.log(`[Supervisor] Auto-selected Ollama model: ${model}`);
      } else {
        throw new Error('No Ollama models available for supervisor. Run: ollama serve');
      }
    }

    // Если модель OpenCode — используем OpenCodeConnect
    const modelIsOpenCode = model && !isOllama && settings.supervisorProvider !== 'openrouter' && (
      model.includes('north-mini') || model.includes('deepseek') ||
      model.includes('glm') || model.includes('kimi') ||
      model.includes('minimax') || model.includes('qwen') ||
      model.includes('mimo') || model.includes('nemotron') ||
      model.includes('big-pickle')
    );

    try {
      if (modelIsOpenCode) {
        const isFreeModel = model.endsWith('-free') || model === 'big-pickle' || model === 'north-mini-code-free';
        const provider = isFreeModel ? 'opencode' : (hasOpenCodeGoKey ? 'opencode-go' : 'opencode');
        console.log(`[Supervisor] Using OpenCode ${provider}/${model}`);
        return await callOpenCodeModel(provider, model, [
          { role: 'system', content: 'Ты — Supervisor Agent. Отвечай строго в JSON формате.' },
          { role: 'user', content: prompt }
        ], { maxTokens, temperature, timeoutMs: this.SUPERVISOR_TIMEOUT_MS });
      }

      if (isOllama) {
        const ollamaUrl = endpoint || getOllamaBaseUrl();
        const response = await fetchWithTimeout(`${ollamaUrl}/api/chat`, {
          timeoutMs: this.SUPERVISOR_TIMEOUT_MS,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: 'Ты — Supervisor Agent. Отвечай строго в JSON формате.' },
              { role: 'user', content: prompt }
            ],
            stream: false,
            options: { temperature, num_predict: maxTokens }
          })
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          throw new Error(`Supervisor Ollama (${model}) error: ${response.status} ${errText}`);
        }

        const data = await response.json();
        return data.message?.content || '';
      } else {
        const response = await fetchWithTimeout(`${endpoint}/api/v1/chat/completions`, {
          timeoutMs: this.SUPERVISOR_TIMEOUT_MS,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: 'Ты — Supervisor Agent. Отвечай строго в JSON формате.' },
              { role: 'user', content: prompt }
            ],
            temperature,
            max_tokens: maxTokens,
            stream: false
          })
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          throw new Error(`Supervisor (${model}) error: ${response.status} ${errText}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || '';
      }
    } catch (err) {
      if (err.message?.includes('timeout after')) {
        throw new Error(`Supervisor (${model}) timeout after ${this.SUPERVISOR_TIMEOUT_MS}ms — endpoint ${endpoint} unreachable`);
      }
      throw err;
    }
  }

  _parsePlan(response, userRequest) {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found');
      const plan = JSON.parse(jsonMatch[0]);
      if (!plan.tasks || !Array.isArray(plan.tasks) || plan.tasks.length === 0) {
        return this._createDefaultPlan(userRequest);
      }
      return {
        tasks: plan.tasks.map((t, i) => ({ ...t, id: uuidv4(), index: i })),
        reasoning: plan.reasoning || 'План сгенерирован автоматически'
      };
    } catch {
      return this._createDefaultPlan(userRequest);
    }
  }

  _createDefaultPlan(userRequest) {
    const hasImage = /https?:\/\/\S+\.(png|jpg|jpeg|gif|webp)/i.test(userRequest) ||
                     /data:image\/[a-z]+;base64/.test(userRequest);
    const hasCodeQuestion = /код|напиш|создай|рефактор|исправ|debug/i.test(userRequest);
    const tasks = [];

    if (hasImage) {
      tasks.push({ id: uuidv4(), index: 0, type: TASK_TYPES.VISION, description: 'Анализ изображения(ий)', dependsOn: [], priority: 5, model_hint: 'auto' });
    }
    if (hasCodeQuestion) {
      tasks.push({ id: uuidv4(), index: tasks.length, type: TASK_TYPES.CODE, description: 'Написание/исправление кода', dependsOn: hasImage ? [0] : [], priority: 5, model_hint: 'auto' });
    }
    if (tasks.length === 0) {
      tasks.push({ id: uuidv4(), index: 0, type: TASK_TYPES.CHAT, description: 'Ответ пользователю', dependsOn: [], priority: 3, model_hint: 'auto' });
    }
    return { tasks, reasoning: 'Автоматический план на основе анализа запроса' };
  }

  async _executeTask(taskDef, workflowId) {
    const task = { id: taskDef.id, workflowId, type: taskDef.type, description: taskDef.description, status: TASK_STATUS.IN_PROGRESS, createdAt: Date.now(), result: null, error: null };
    try {
      const agent = agentPool.getAgent(taskDef.type);
      if (!agent) throw new Error(`No agent available for task type: ${taskDef.type}`);

      const result = await Promise.race([
        taskRouter.route(taskDef, agent),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`Task "${taskDef.description}" timed out after ${this.TASK_TIMEOUT_MS}ms`)), this.TASK_TIMEOUT_MS))
      ]);

      task.status = TASK_STATUS.COMPLETED;
      task.result = result;
      task.completedAt = Date.now();
    } catch (error) {
      task.status = TASK_STATUS.FAILED;
      task.error = error.message;
      console.error(`[Supervisor] Task failed: ${taskDef.type} | ${error.message}`);
    }

    this.tasks.set(task.id, task);
    if (this.tasks.size > this.MAX_TASKS_PER_WORKFLOW * 10) {
      const toDelete = [];
      for (const [id, t] of this.tasks) {
        if (t.status === TASK_STATUS.COMPLETED || t.status === TASK_STATUS.FAILED) {
          toDelete.push(id);
          if (toDelete.length >= 500) break;
        }
      }
      for (const id of toDelete) this.tasks.delete(id);
    }
    return task;
  }

  _canRetry(workflow, settings) {
    return (workflow.retryCount || 0) < (settings?.maxRetries ?? 3);
  }

  async _rework(workflow, review) {
    try {
      const reworkPrompt = `Предыдущий результат не прошёл проверку.\nЗапрос: "${workflow.userRequest}"\nЗамечания: ${review.feedback}\n\nИсправь ошибки и верни улучшенный результат.`;
      const plan = await this._planTasks(reworkPrompt, workflow.options);
      workflow.plan = plan;
      workflow.status = TASK_STATUS.IN_PROGRESS;
      const results = [];
      for (const taskDef of plan.tasks) {
        const task = await this._executeTask(taskDef, workflow.id);
        results.push(task);
        workflow.tasks.push(task);
      }
      const finalReview = await qualityGate.review(plan, results, workflow.userRequest);
      workflow.status = finalReview.passed ? TASK_STATUS.COMPLETED : TASK_STATUS.FAILED;
      workflow.completedAt = Date.now();
      workflow.result = this._buildFinalResult(plan, results, finalReview);
      return workflow;
    } catch (err) {
      console.error(`[Supervisor] _rework failed: ${err.message}`);
      workflow.status = TASK_STATUS.FAILED;
      workflow.error = `Rework failed: ${err.message}`;
      workflow.completedAt = Date.now();
      workflow.result = this._buildFinalResult(
        workflow.plan || { tasks: [], reasoning: 'Rework failed' },
        workflow.tasks || [],
        { passed: false, summary: `Rework error: ${err.message}` }
      );
      return workflow;
    }
  }

  _buildFinalResult(plan, results, review) {
    return {
      plan: plan.reasoning,
      tasks: results.map(r => ({
        type: r.type, description: r.description, status: r.status,
        summary: r.result ? r.result.substring(0, 500) : null
      })),
      review: { passed: review.passed, summary: review.summary },
      fullResults: results
    };
  }

  getWorkflow(workflowId) { return this.workflows.get(workflowId); }
  getActiveWorkflows() { return Array.from(this.workflows.values()).filter(w => w.status !== TASK_STATUS.COMPLETED && w.status !== TASK_STATUS.FAILED); }
  getAllWorkflows() { return Array.from(this.workflows.values()); }
  getActiveWorkflowCount() { return this.getActiveWorkflows().length; }

  _cleanupStaleWorkflows() {
    try {
      const now = Date.now();
      let removed = 0;
      for (const [id, wf] of this.workflows) {
        const isTerminal = wf.status === TASK_STATUS.COMPLETED || wf.status === TASK_STATUS.FAILED;
        if (isTerminal && wf.completedAt && now - wf.completedAt > this.WORKFLOW_TTL_MS) {
          for (const task of wf.tasks || []) this.tasks.delete(task.id);
          this.workflows.delete(id);
          removed++;
        }
      }
      if (removed > 0) console.log(`[Supervisor] Cleanup: removed ${removed} stale workflow(s)`);
    } catch (err) {
      console.error(`[Supervisor] Cleanup error: ${err.message}`);
    }
  }
}

// Синглтон
export const supervisor = new Supervisor();
