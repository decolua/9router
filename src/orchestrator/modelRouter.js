/**
 * Model Router — маршрутизация запросов по моделям с поддержкой:
 * - Round-robin переключения между моделями
 * - Condition-based выбора (цена, лимиты, тип задачи, время)
 * - Failover при недоступности модели
 * - Приоритетов моделей
 * - Интеграции с бесплатными и локальными моделями (Ollama)
 * - Ограничений rate limit и cooldown для каждой модели
 * - Полной статистики здоровья и использования моделей
 * - Самодиагностики (roulette) всех доступных моделей
 * - Автоматического обнаружения моделей Ollama (autodiscovery)
 *
 * Конфигурация моделей — ДИНАМИЧЕСКАЯ:
 * - При старте: autodiscovery Ollama → автозаполнение групп
 * - OLLAMA_BASE_URL из env (по умолчанию http://localhost:11434)
 * - Классификация моделей по имени: *coder* → code, *vision* → vision, etc.
 */

import { fetchWithTimeout } from '@/shared/utils/fetchWithTimeout.js';

// Состояние round-robin счётчиков для каждой группы
const roundRobinCounters = new Map();

/**
 * Определить Ollama base URL из env
 */
function getOllamaBaseUrl() {
  return (
    process.env.OLLAMA_BASE_URL ||
    'http://localhost:11434'
  ).replace(/\/$/, '');
}

/**
 * Классифицировать модель по имени в группы задач
 * Возвращает массив групп, к которым модель подходит
 */
function classifyModel(modelName) {
  const name = (modelName || '').toLowerCase();
  const groups = [];

  // Code-специализированные модели
  if (name.includes('coder') || name.includes('codestral') || name.includes('starcoder') || name.includes('deepseek-coder')) {
    groups.push('code');
    groups.push('code_review');
  }

  // Vision-модели
  if (name.includes('vision') || name.includes('llava') || name.includes('bakllava') || name.includes('moondream')) {
    groups.push('vision');
  }

  // Embedding-модели
  if (name.includes('embed') || name.includes('nomic') || name.includes('mxbai-embed') || name.includes('all-minilm')) {
    groups.push('embeddings');
  }

  // Универсальные модели — добавляем в chat, web_search, и если нет специализации — везде
  groups.push('chat');
  groups.push('web_search');

  // Если модель крупная (>= 14b) — пригодна и для code_review
  const sizeMatch = name.match(/(\d+)b/);
  if (sizeMatch && parseInt(sizeMatch[1]) >= 14 && !groups.includes('code_review')) {
    groups.push('code_review');
  }

  return [...new Set(groups)];
}

/**
 * Определить приоритет модели на основе размера и типа
 * Меньше = выше приоритет
 */
function inferPriority(modelName) {
  const name = (modelName || '').toLowerCase();

  // Облачные модели — высший приоритет (обычно мощнее)
  if (name.includes(':cloud') || name.includes('cloud')) return 1;

  // Крупные модели
  const sizeMatch = name.match(/(\d+)b/);
  if (sizeMatch) {
    const size = parseInt(sizeMatch[1]);
    if (size >= 30) return 2;
    if (size >= 14) return 3;
    if (size >= 7) return 4;
    return 5;
  }

  return 3; // дефолтный средний приоритет
}

/**
 * Определить maxTokens по размеру модели
 */
function inferMaxTokens(modelName, ollamaDetails) {
  const name = (modelName || '').toLowerCase();

  // Если Ollama дал размер параметров
  if (ollamaDetails?.parameter_size) {
    const sizeStr = ollamaDetails.parameter_size;
    const num = parseInt(sizeStr);
    if (num >= 30) return 32768;
    if (num >= 14) return 16384;
    return 8192;
  }

  // По имени
  if (name.includes(':cloud') || name.includes('cloud')) return 32768;
  const sizeMatch = name.match(/(\d+)b/);
  if (sizeMatch) {
    const size = parseInt(sizeMatch[1]);
    if (size >= 30) return 32768;
    if (size >= 14) return 16384;
    return 8192;
  }

  return 16384; // дефолт
}

/**
 * Определить rateLimit — облачные модели имеют лимиты, локальные — нет
 */
function inferRateLimit(modelName) {
  const name = (modelName || '').toLowerCase();
  if (name.includes(':cloud') || name.includes('cloud')) return 30;
  return 0; // локальные — без лимитов
}

class ModelRouter {
  constructor() {
    // Конфигурация по умолчанию — группы моделей ПУСТЫЕ, заполняются через autodiscovery
    this.defaultConfig = {
      // Стратегия: 'round_robin' | 'priority' | 'cost_optimized' | 'conditional'
      strategy: 'conditional',

      // Группы моделей для разных типов задач — заполняются автоматически
      modelGroups: {
        chat: { models: [], strategy: 'conditional', fallbackModel: null, enabled: true },
        code: { models: [], strategy: 'priority', fallbackModel: null, enabled: true },
        code_review: { models: [], strategy: 'priority', fallbackModel: null, enabled: true },
        vision: { models: [], strategy: 'priority', fallbackModel: null, enabled: true },
        web_search: { models: [], strategy: 'round_robin', fallbackModel: null, enabled: true },
        embeddings: { models: [], strategy: 'priority', fallbackModel: null, enabled: false }
      },

      // Глобальные лимиты (бесплатно — без лимитов)
      globalCostLimitPerDay: 0.0,
      globalTokenLimitPerDay: 5000000,

      // Настройки переключения
      switching: {
        enabled: true,
        cooldownMinutes: 0,     // без паузы для локальных моделей
        minCostDiff: 0.0,
        respectRateLimits: true,
        preferFreeModels: true,
        maxConsecutiveFreeRequests: 10,
        rotationIntervalMinutes: 5,
        smartRotation: true,
        timeBasedRules: [
          { from: '08:00', to: '23:59', preferQuality: true, minQualityScore: 0.7 },
          { from: '00:00', to: '07:59', preferFree: true }
        ]
      },

      // Настройки авто-обнаружения Ollama
      ollama: {
        baseUrl: getOllamaBaseUrl(),
        autoDiscover: true,
        discoverIntervalMs: 60000,
        lastDiscovery: null
      },

      // Настройки rate limiting
      rateLimiting: {
        enabled: false,
        globalRequestsPerMinute: 100,
        perModelRequestsPerMinute: 30,
        burstLimit: 5,
        retryAfterOnLimit: 30
      },

      // Настройки приоритетов по времени
      scheduling: {
        enabled: true,
        timezone: 'auto',
        peakHours: { start: '09:00', end: '17:00' },
        peakHourCostMultiplier: 1.0,
        offPeakStrategy: 'round_robin',
        weekendStrategy: 'round_robin'
      },

      // Настройки RouterAI — управление бесплатными моделями и Ollama
      routerAI: {
        enabled: true,
        manageFreeModels: true,
        includeOllama: true,
        freeModelTimeout: 90000,
        maxFreeModelsPerGroup: 5,
        freeModelCooldownSeconds: 5,
        autoEnableAfterError: true
      },

      // Настройки мониторинга
      monitoring: {
        enabled: true,
        logRotations: true,
        logErrors: true,
        alertOnCostSpike: false,
        logLevel: 'info'
      }
    };

    this.config = { ...this.defaultConfig };
    this.dailyUsage = {
      date: new Date().toDateString(),
      costs: {},
      tokens: {},
      requests: {},
      errors: {},
      totalCost: 0,
      totalTokens: 0,
      totalErrors: 0
    };

    this.hourlyUsage = {
      currentHour: new Date().getHours(),
      costs: {},
      totalCost: 0
    };

    this.modelStatus = new Map();
    this.lastRotationTime = Date.now();
    this.consecutiveFreeRequests = 0;
    this.rotationHistory = [];
    this.requestTimestamps = [];

    // Результаты последнего пинга (roulette)
    this.lastRouletteResults = null;
    this.lastRouletteTime = null;

    // Флаг: были ли модели уже обнаружены
    this._discoveryDone = false;

    // Автодискавери при старте (не блокирующий)
    this._scheduleInitialDiscovery();
  }

  /**
   * Запланировать первичное обнаружение моделей
   */
  _scheduleInitialDiscovery() {
    // Запускаем через 2 секунды после старта чтобы не блокировать инициализацию
    const timer = setTimeout(async () => {
      try {
        await this.discoverAndPopulateModels();
      } catch (err) {
        this._log('warn', `Initial discovery failed: ${err.message}`);
      }
    }, 2000);
    timer.unref?.();

    // Периодическое обнаружение
    const interval = setInterval(async () => {
      try {
        await this.discoverAndPopulateModels();
      } catch (err) {
        this._log('warn', `Periodic discovery failed: ${err.message}`);
      }
    }, this.config.ollama.discoverIntervalMs || 60000);
    interval.unref?.();
  }

  /**
   * Обнаружить модели Ollama и автоматически заполнить группы
   */
  async discoverAndPopulateModels() {
    const discovered = await this.discoverOllamaModels();
    if (discovered.length === 0) {
      this._log('info', 'No Ollama models found — groups remain empty');
      return;
    }

    // Заполняем группы на основе классификации
    for (const model of discovered) {
      const groups = classifyModel(model.id);
      for (const groupName of groups) {
        const group = this.config.modelGroups[groupName];
        if (!group) continue;

        // Проверяем, не дублируется ли модель
        const exists = group.models.some(m => m.id === model.id);
        if (!exists) {
          group.models.push(model);
          this._log('info', `Auto-added model ${model.id} to group "${groupName}"`);
        }
      }
    }

    // Обновляем fallback моделей для каждой группы
    for (const [groupName, group] of Object.entries(this.config.modelGroups)) {
      if (group.models.length > 0 && !group.fallbackModel) {
        // Fallback — модель с наивысшим приоритетом (наименьшее число)
        const sorted = [...group.models].sort((a, b) => a.priority - b.priority);
        group.fallbackModel = sorted[0].id;
      }
    }

    this._discoveryDone = true;
    this._log('info', `Discovery complete: ${discovered.length} models found, distributed across groups`);
  }

  /**
   * Инициализация/обновление конфигурации
   */
  updateConfig(newConfig) {
    // Глубокое слияние
    const merge = (target, source) => {
      for (const key in source) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          if (!target[key]) target[key] = {};
          merge(target[key], source[key]);
        } else {
          target[key] = source[key];
        }
      }
    };
    merge(this.config, newConfig);
    this._log('info', 'Config updated');
  }

  /**
   * Получить следующую модель для указанной группы
   */
  getNextModel(groupType, context = {}) {
    const group = this.config.modelGroups[groupType];
    if (!group || !group.enabled) {
      this._log('warn', `Group ${groupType} not found or disabled`);
      return null;
    }

    // Фильтруем доступные модели
    const available = group.models.filter(m => this._isModelAvailable(m.id));
    if (available.length === 0) {
      const fallback = group.fallbackModel;
      this._log('warn', `No available models in ${groupType}, using fallback: ${fallback}`);
      return this._getModelById(fallback, groupType) || group.models[0] || null;
    }

    // Выбираем стратегию
    const strategy = context.strategy || group.strategy || this.config.strategy;
    
    let model;
    switch (strategy) {
      case 'round_robin':
        model = this._roundRobin(available, groupType);
        break;
      case 'priority':
        model = this._priority(available, context);
        break;
      case 'cost_optimized':
        model = this._costOptimized(available);
        break;
      case 'conditional':
      default:
        model = this._conditional(available, groupType, context);
        break;
    }

    if (!model) {
      model = available[0];
    }

    // Проверяем cooldown
    if (this._isOnCooldown(model.id)) {
      this._log('info', `${model.id} on cooldown, trying next`);
      const next = available.find(m => !this._isOnCooldown(m.id));
      if (next) model = next;
    }

    this._log('info', `Selected model ${model.id} for ${groupType} (strategy: ${strategy})`);
    return model;
  }

  /**
   * Round-robin выбор из доступных моделей
   */
  _roundRobin(available, groupType) {
    let counter = roundRobinCounters.get(groupType) || 0;
    const model = available[counter % available.length];
    roundRobinCounters.set(groupType, counter + 1);
    return model;
  }

  /**
   * Приоритетный выбор
   */
  _priority(available, context) {
    // Сортируем по приоритету (меньше = выше приоритет)
    const sorted = [...available].sort((a, b) => a.priority - b.priority);
    
    // Если задача сложная — берём самую качественную (приоритет 1)
    if (context.complexity === 'high' || context.requiresQuality) {
      return sorted[0];
    }
    
    return sorted[0];
  }

  /**
   * Выбор по стоимости
   */
  _costOptimized(available) {
    return [...available].sort((a, b) => a.costPer1K - b.costPer1K)[0];
  }

  /**
   * Условный выбор — анализирует тип задачи, время, сложность
   */
  _conditional(available, groupType, context) {
    const now = new Date();
    const hour = now.getHours();
    const isNight = hour >= 0 && hour < 8;
    const isWeekend = now.getDay() === 0 || now.getDay() === 6;

    // Ночью — round_robin для равномерной нагрузки всех моделей
    if (isNight) {
      return this._roundRobin(available, groupType);
    }

    // Выходные — распределяем равномерно
    if (isWeekend) {
      return this._roundRobin(available, groupType);
    }

    // code/code_review — приоритет кодеров
    if ((groupType === 'code' || groupType === 'code_review') && context.complexity !== 'simple') {
      const coders = available.filter(m => m.id.includes('coder'));
      if (coders.length > 0) {
        return coders.sort((a, b) => a.priority - b.priority)[0];
      }
    }

    // Сложные задачи — самые мощные модели
    if (context.complexity === 'high' || context.requiresQuality) {
      const top = available.filter(m => m.priority <= 3);
      if (top.length > 0) return top.sort((a, b) => a.priority - b.priority)[0];
    }

    // По умолчанию — round_robin
    return this._roundRobin(available, groupType);
  }

  /**
   * Проверка доступности модели
   */
  _isModelAvailable(modelId) {
    const status = this.modelStatus.get(modelId);
    if (!status) return true; // нет статуса — считаем доступной
    if (status.available === false) return false;
    if (status.cooldownUntil && Date.now() < status.cooldownUntil) return false;
    return true;
  }

  /**
   * Проверка cooldown
   */
  _isOnCooldown(modelId) {
    const status = this.modelStatus.get(modelId);
    if (!status) return false;
    return status.cooldownUntil && Date.now() < status.cooldownUntil;
  }

  /**
   * Получить модель по ID из группы
   */
  _getModelById(modelId, groupType) {
    const group = this.config.modelGroups[groupType];
    if (!group) return null;
    return group.models.find(m => m.id === modelId) || null;
  }

  /**
   * Отметить модель как недоступную
   */
  markModelUnavailable(modelId, error = null) {
    const status = this.modelStatus.get(modelId) || {};
    status.available = false;
    status.lastError = error?.message || error || 'Unknown error';
    status.lastErrorTime = Date.now();
    
    // Авто-восстановление через 30 секунд
    status.cooldownUntil = Date.now() + 30000;
    this.modelStatus.set(modelId, status);
    
    this._log('warn', `Model ${modelId} marked unavailable: ${status.lastError}`);
    this.dailyUsage.errors[modelId] = (this.dailyUsage.errors[modelId] || 0) + 1;
    this.dailyUsage.totalErrors++;
  }

  /**
   * Отметить модель как доступную
   */
  markModelAvailable(modelId) {
    const status = this.modelStatus.get(modelId) || {};
    status.available = true;
    status.cooldownUntil = null;
    status.lastError = null;
    this.modelStatus.set(modelId, status);
  }

  /**
   * Записать использование модели
   */
  recordUsage(modelId, tokens, cost = 0) {
    this.dailyUsage.requests[modelId] = (this.dailyUsage.requests[modelId] || 0) + 1;
    this.dailyUsage.tokens[modelId] = (this.dailyUsage.tokens[modelId] || 0) + tokens;
    this.dailyUsage.totalTokens += tokens;
    this.dailyUsage.costs[modelId] = (this.dailyUsage.costs[modelId] || 0) + cost;
    this.dailyUsage.totalCost += cost;
    
    // Сброс ошибок при успешном использовании
    const status = this.modelStatus.get(modelId);
    if (status) {
      status.available = true;
      status.lastError = null;
      status.lastUsed = Date.now();
    } else {
      this.modelStatus.set(modelId, { available: true, lastUsed: Date.now() });
    }
  }

  /**
   * Получить следующую модель для указанной группы (алиас для совместимости)
   */
  selectModel(groupType, context = {}) {
    return this.getNextModel(groupType, context);
  }

  /**
   * Получить конфигурацию
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Получить статистику
   */
  getStats() {
    return {
      dailyUsage: this.dailyUsage,
      modelStatus: Object.fromEntries(this.modelStatus),
      rotationHistory: this.rotationHistory.slice(-50),
      lastRoulette: this.lastRouletteResults ? {
        time: this.lastRouletteTime,
        results: this.lastRouletteResults
      } : null,
      config: this.config
    };
  }

  /**
   * РУЛЕТКА — пинг всех доступных моделей
   * Отправляет тестовый запрос каждой модели, замеряет скорость
   * Возвращает результаты: модель, статус, время ответа, ошибка
   */
  async roulette() {
    this._log('info', 'Starting roulette — pinging all available models');

    // Собираем все уникальные модели из всех групп
    const allModels = new Map();
    for (const [groupType, group] of Object.entries(this.config.modelGroups)) {
      for (const model of group.models) {
        if (!allModels.has(model.id)) {
          allModels.set(model.id, { ...model, groups: [groupType] });
        } else {
          allModels.get(model.id).groups.push(groupType);
        }
      }
    }

    const modelList = Array.from(allModels.values());
    const results = [];

    // Тестовый промпт — короткий, чтобы быстро получить ответ
    const testPrompt = 'Respond with only the word "ok".';

    // Пингуем все модели параллельно, но с лимитом (3 одновременно)
    const concurrencyLimit = 3;
    const chunks = [];
    for (let i = 0; i < modelList.length; i += concurrencyLimit) {
      chunks.push(modelList.slice(i, i + concurrencyLimit));
    }

    for (const chunk of chunks) {
      const promises = chunk.map(model => this._pingModel(model, testPrompt));
      const chunkResults = await Promise.allSettled(promises);
      
      for (const result of chunkResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
          // Обновляем статус модели
          if (result.value.success) {
            this.markModelAvailable(result.value.modelId);
          } else {
            this.markModelUnavailable(result.value.modelId, result.value.error);
          }
        } else {
          results.push({
            modelId: 'unknown',
            success: false,
            error: result.reason?.message || 'Promise rejected',
            latency: 0
          });
        }
      }
    }

    // Сортируем: сначала рабочие, потом ошибки
    results.sort((a, b) => {
      if (a.success && !b.success) return -1;
      if (!a.success && b.success) return 1;
      return a.latency - b.latency;
    });

    this.lastRouletteResults = results;
    this.lastRouletteTime = Date.now();

    this._log('info', `Roulette complete: ${results.filter(r => r.success).length}/${results.length} models working`);

    return {
      timestamp: this.lastRouletteTime,
      total: results.length,
      working: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results
    };
  }

  /**
   * Пинг одной модели через Ollama API
   */
  async _pingModel(model, testPrompt) {
    const startTime = Date.now();
    const modelId = model.id;
    const ollamaUrl = this.config.ollama?.baseUrl || getOllamaBaseUrl();
    
    try {
      // Формируем запрос к Ollama API (локальный) с таймаутом
      const response = await fetchWithTimeout(`${ollamaUrl}/api/chat`, {
        timeoutMs: 20000,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: modelId,
          messages: [
            { role: 'user', content: testPrompt }
          ],
          stream: false,
          options: {
            num_predict: 10, // минимум токенов для быстрого ответа
            temperature: 0
          }
        })
      });

      const latency = Date.now() - startTime;

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        return {
          modelId,
          groups: model.groups,
          provider: model.provider,
          success: false,
          latency,
          status: response.status,
          error: `HTTP ${response.status}: ${errorText.substring(0, 200)}`
        };
      }

      const data = await response.json();
      const totalLatency = Date.now() - startTime;

      return {
        modelId,
        groups: model.groups,
        provider: model.provider,
        success: true,
        latency: totalLatency,
        status: response.status,
        responsePreview: data.message?.content?.substring(0, 100) || '(no content)',
        tokensGenerated: data.eval_count || 0,
        tokensPerSecond: data.eval_count && data.eval_duration 
          ? Math.round((data.eval_count / (data.eval_duration / 1e9)) * 100) / 100 
          : 0
      };
    } catch (err) {
      const latency = Date.now() - startTime;
      return {
        modelId,
        groups: model.groups,
        provider: model.provider,
        success: false,
        latency,
        error: err.name === 'TimeoutError' ? 'Timeout (20s)' : (err.message || String(err)),
        status: 0
      };
    }
  }

  /**
   * Авто-обнаружение моделей в Ollama
   */
  async discoverOllamaModels() {
    const ollamaUrl = this.config.ollama?.baseUrl || getOllamaBaseUrl();
    try {
      const response = await fetchWithTimeout(`${ollamaUrl}/api/tags`, {
        timeoutMs: 10000
      });
      
      if (!response.ok) {
        this._log('warn', `Ollama discovery failed: HTTP ${response.status}`);
        return [];
      }

      const data = await response.json();
      const models = (data.models || []).map(m => ({
        id: m.name,
        provider: 'ollama-local',
        priority: inferPriority(m.name),
        costPer1K: 0.0,
        maxTokens: inferMaxTokens(m.name, m.details),
        rateLimit: inferRateLimit(m.name),
        cooldownMinutes: 0
      }));

      if (models.length > 0) {
        this.config.ollama.lastDiscovery = Date.now();
        this._log('info', `Ollama discovery: found ${models.length} models: ${models.map(m => m.id).join(', ')}`);
      }

      return models;
    } catch (err) {
      this._log('warn', `Ollama discovery failed: ${err.message}`);
      return [];
    }
  }

  /**
   * Получить первую доступную модель (для fallback supervisor/review)
   * Приоритет: облачные > крупные > любые
   */
  getFirstAvailableModel() {
    // Ищем в группе chat
    const chatGroup = this.config.modelGroups.chat;
    if (chatGroup && chatGroup.models.length > 0) {
      const available = chatGroup.models.filter(m => this._isModelAvailable(m.id));
      if (available.length > 0) {
        return available.sort((a, b) => a.priority - b.priority)[0];
      }
      return chatGroup.models[0];
    }
    return null;
  }

  /**
   * Получить конфигурацию для UI
   */
  getUIConfig() {
    // Возвращаем только то, что нужно для отображения в дашборде
    const groups = {};
    for (const [key, group] of Object.entries(this.config.modelGroups)) {
      groups[key] = {
        strategy: group.strategy,
        fallbackModel: group.fallbackModel,
        enabled: group.enabled,
        models: group.models.map(m => ({
          id: m.id,
          provider: m.provider,
          priority: m.priority,
          status: this.modelStatus.get(m.id)?.available !== false ? 'available' : 'unavailable'
        }))
      };
    }

    return {
      strategy: this.config.strategy,
      groups,
      ollama: {
        baseUrl: this.config.ollama.baseUrl,
        autoDiscover: this.config.ollama.autoDiscover
      },
      lastRoulette: this.lastRouletteTime,
      roundRobinCounters: Object.fromEntries(roundRobinCounters)
    };
  }

  /**
   * Логирование
   */
  _log(level, message) {
    if (this.config.monitoring?.logLevel === 'debug' && level === 'debug') {
      console.log(`[ModelRouter] ${message}`);
    } else if (level === 'info' || level === 'warn' || level === 'error') {
      const prefix = level === 'error' ? '[ModelRouter ERROR]' : level === 'warn' ? '[ModelRouter WARN]' : '[ModelRouter]';
      console.log(`${prefix} ${message}`);
    }
  }

  /**
   * Загрузить сохранённый routerAI-конфиг из постоянного хранилища (SQLite)
   * Нужно вызвать после инстанциирования, когда DB уже доступна.
   */
  async restoreFromSettings(getSettingsFn) {
    try {
      if (typeof getSettingsFn !== 'function') {
        this._log('warn', 'restoreFromSettings: getSettingsFn is not a function, skipping');
        return;
      }
      const dbSettings = await getSettingsFn();
      if (dbSettings && dbSettings.routerAI && typeof dbSettings.routerAI === 'object') {
        this.updateConfig({ routerAI: dbSettings.routerAI });
        this._log('info', 'RouterAI config restored from DB: enabled=' + dbSettings.routerAI.enabled +
          ', timeout=' + dbSettings.routerAI.freeModelTimeout);
      } else {
        this._log('info', 'No saved RouterAI config in DB, using defaults');
      }
    } catch (err) {
      this._log('warn', `restoreFromSettings failed: ${err.message}`);
    }
  }
}

// Синглтон
export const modelRouter = new ModelRouter();
export default ModelRouter;
