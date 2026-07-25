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
import { getSettings, updateSettings } from '@/lib/localDb.js';
import {
  OPENCODE_GO_MODELS,
  discoverOpenCodeFreeModels,
  hasOpenCodeGoKey,
  setFreeModelsCache,
} from './opencodeConnect.js';

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
  if (name.includes('vision') || name.includes('llava') || name.includes('bakllava') || name.includes('moondream') || name.includes('vl')) {
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
        maxFreeModelsPerGroup: 20,
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

    this._persistTimer = null;
    this._restoreStats();

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

    // OpenCode модели (статичные + будут обновлены при discovery)
    this._opencodeFreeModels = [];
    this._opencodeGoAvailable = !!(process.env.PROVIDER_OPENCODE_KEY || '').trim();

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
    this._log('info', `Discovery complete: ${discovered.length} Ollama models found, distributed across groups`);

    // После Ollama discovery — заполняем OpenCode модели
    await this._discoverAndPopulateOpenCode();

    // LM Studio discovery
    const lmStudioModels = await this.discoverLMStudioModels();
    for (const model of lmStudioModels) {
      const groups = model.groups;
      for (const groupName of groups) {
        const group = this.config.modelGroups[groupName];
        if (!group) continue;
        const exists = group.models.some(m => m.id === model.id && m.provider === model.provider);
        if (!exists) {
          group.models.push(model);
          this._log('info', `Auto-added LM Studio model ${model.id} to group "${groupName}"`);
        }
      }
    }
    if (lmStudioModels.length > 0) {
      this._log('info', `LM Studio: ${lmStudioModels.length} models added`);
    }

    // OpenRouter discovery (только топ-модели, чтобы не засорять)
    const orModels = await this.discoverOpenRouterModels();
    const topORModels = orModels.filter(m =>
      m.id.includes('gpt-4o') || m.id.includes('claude-sonnet-4') ||
      m.id.includes('gemini-2.5') || m.id.includes('deepseek') ||
      m.id.includes('qwen') || m.id.includes('llama-4')
    ).slice(0, 20);
    for (const model of topORModels) {
      const groups = classifyModel(model.id);
      for (const groupName of groups) {
        const group = this.config.modelGroups[groupName];
        if (!group) continue;
        const exists = group.models.some(m => m.id === model.id && m.provider === model.provider);
        if (!exists) {
          group.models.push(model);
        }
      }
    }
    if (topORModels.length > 0) {
      this._log('info', `OpenRouter: ${topORModels.length} top models added`);
    }
  }

  /**
   * Обнаружить модели LM Studio
   */
  async discoverLMStudioModels() {
    const all = [];
    const urls = ['http://127.0.0.1:1234', 'http://host.docker.internal:1234'];
    for (const baseUrl of urls) {
      try {
        const res = await fetch(`${baseUrl}/v1/models`, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          const data = await res.json();
          const models = data.data || data.models || [];
          for (const m of models) {
            const modelId = m.id || m.name || m.model;
            if (!modelId) continue;
            all.push({
              id: modelId,
              name: modelId,
              provider: 'lm-studio',
              source: 'local',
              priority: 3,
              costPer1K: 0,
              tier: 'free',
              maxTokens: 16384,
              rateLimit: 0,
              groups: classifyModel(modelId),
            });
          }
          this._log('info', `LM Studio: discovered ${models.length} models from ${baseUrl}`);
        }
      } catch (err) {
        this._log('info', `LM Studio not reachable at ${baseUrl}: ${err.message}`);
      }
    }
    return all;
  }

  /**
   * Обнаружить модели OpenRouter
   */
  async discoverOpenRouterModels() {
    const all = [];
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        const models = data.data || data.models || [];
        for (const m of models) {
          const modelId = m.id;
          if (!modelId) continue;
          all.push({
            id: modelId,
            name: m.name || modelId,
            provider: 'openrouter',
            source: 'cloud',
            priority: 3,
            costPer1K: 0.001,
            tier: 'paid',
            maxTokens: m.context_length || 32768,
            rateLimit: 30,
            groups: classifyModel(modelId),
          });
        }
        this._log('info', `OpenRouter: discovered ${all.length} models`);
      }
    } catch (err) {
      this._log('info', `OpenRouter not reachable: ${err.message}`);
    }
    return all;
  }

  /**
   * Обнаружить модели OpenCode и добавить в группы
   */
  async _discoverAndPopulateOpenCode() {
    // OpenCode Free — динамический список + fallback на известные
    const freeModels = await discoverOpenCodeFreeModels();
    setFreeModelsCache(freeModels);
    this._opencodeFreeModels = freeModels;

    const allModels = [...freeModels];

    // OpenCode Go — только если есть ключ
    if (this._opencodeGoAvailable) {
      allModels.push(...OPENCODE_GO_MODELS);
    }

    if (allModels.length === 0) return;

    let added = 0;
    for (const model of allModels) {
      const groups = model.groups || classifyModel(model.id);
      for (const groupName of groups) {
        const group = this.config.modelGroups[groupName];
        if (!group) continue;

        const exists = group.models.some(m => m.id === model.id && m.provider === model.provider);
        if (!exists) {
          group.models.push(model);
          added++;
        }
      }
    }

    // Обновить fallback, если модели появились
    for (const group of Object.values(this.config.modelGroups)) {
      if (group.models.length > 0 && !group.fallbackModel) {
        const sorted = [...group.models].sort((a, b) => a.priority - b.priority);
        group.fallbackModel = sorted[0].id;
      }
    }

    this._log('info', `OpenCode: added ${added} models (${freeModels.length} free)`);
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
   * Полный сброс всей статистики ModelRouter
   */
  resetAll() {
    this.dailyUsage = {
      date: new Date().toDateString(),
      costs: {},
      tokens: {},
      requests: {},
      errors: {},
      totalCost: 0,
      totalTokens: 0,
      totalRequests: 0,
      totalErrors: 0
    };
    this.hourlyUsage = {
      currentHour: new Date().getHours(),
      costs: {},
      totalCost: 0
    };
    this.modelStatus = new Map();
    this.rotationHistory = [];
    this.requestTimestamps = [];
    this.consecutiveFreeRequests = 0;
    this.lastRotationTime = Date.now();
    roundRobinCounters.clear();
    this._log('info', 'All stats reset');
  }

  /**
   * Проверить смену дня — сбросить dailyUsage если начался новый день
   */
  _checkDailyRollover() {
    const today = new Date().toDateString();
    if (this.dailyUsage.date !== today) {
      this._log('info', `Daily rollover: ${this.dailyUsage.date} → ${today}`);
    this.dailyUsage = {
      date: new Date().toDateString(),
      costs: {},
      tokens: {},
      requests: {},
      errors: {},
      totalCost: 0,
      totalTokens: 0,
      totalRequests: 0,
      totalErrors: 0
    };
    }
  }

  /**
   * Проверить смену часа — сбросить hourlyUsage
   */
  _checkHourlyRollover() {
    const currentHour = new Date().getHours();
    if (this.hourlyUsage.currentHour !== currentHour) {
      this.hourlyUsage = {
        currentHour,
        costs: {},
        totalCost: 0
      };
    }
  }

  /**
   * Проверить глобальные лимиты стоимости и токенов
   */
  _checkGlobalLimits() {
    const costLimit = this.config.globalCostLimitPerDay;
    const tokenLimit = this.config.globalTokenLimitPerDay;

    if (costLimit > 0 && this.dailyUsage.totalCost >= costLimit) {
      return { allowed: false, reason: `Daily cost limit $${costLimit} reached ($${this.dailyUsage.totalCost.toFixed(4)})` };
    }
    if (tokenLimit > 0 && this.dailyUsage.totalTokens >= tokenLimit) {
      return { allowed: false, reason: `Daily token limit ${Intl.NumberFormat().format(tokenLimit)} reached (${Intl.NumberFormat().format(this.dailyUsage.totalTokens)})` };
    }

    return { allowed: true };
  }

  /**
   * Проверить rate limiting (глобальный RPM)
   */
  _isRateLimited() {
    const rl = this.config.rateLimiting;
    if (!rl?.enabled) return false;

    const oneMinuteAgo = Date.now() - 60000;
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > oneMinuteAgo);
    return this.requestTimestamps.length >= (rl.globalRequestsPerMinute || 100);
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

    // Check daily rollover and global limits
    this._checkDailyRollover();
    this._checkHourlyRollover();
    const limitCheck = this._checkGlobalLimits();
    if (!limitCheck.allowed) {
      this._log('warn', `Global limit reached: ${limitCheck.reason}`);
      return null;
    }

    // Check rate limiting
    if (this._isRateLimited()) {
      this._log('warn', `Rate limit exceeded (${this.requestTimestamps.length}/${this.config.rateLimiting.globalRequestsPerMinute} RPM)`);
      return null;
    }

    // Check max consecutive free requests
    const maxFree = this.config.switching?.maxConsecutiveFreeRequests ?? 10;
    if (this.consecutiveFreeRequests >= maxFree) {
      this._log('info', `Max consecutive free requests (${maxFree}) reached, forcing paid model`);
      const paid = group.models.filter(m => m.costPer1K > 0 && this._isModelAvailable(m.id));
      if (paid.length > 0) {
        this.consecutiveFreeRequests = 0;
        const model = paid.sort((a, b) => a.priority - b.priority)[0];
        this._log('info', `Selected paid model ${model.id} after free streak`);
        return model;
      }
    }

    // Если есть изображения — принудительно vision-модель
    const hasImages = context.images || context.hasImages;
    if (hasImages) {
      const visionGroup = this.config.modelGroups.vision;
      if (visionGroup && visionGroup.enabled) {
        const visionModels = visionGroup.models.filter(m => this._isModelAvailable(m.id));
        if (visionModels.length > 0) {
          const sorted = visionModels.sort((a, b) => a.priority - b.priority);
          this._log('info', `Images detected → forced vision model: ${sorted[0].id}`);
          return sorted[0];
        }
      }
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

    // Track consecutive free requests
    if (model.costPer1K === 0) {
      this.consecutiveFreeRequests++;
    } else {
      this.consecutiveFreeRequests = 0;
    }

    // Track request timestamp for rate limiting
    this.requestTimestamps.push(Date.now());
    // Keep only last minute of timestamps
    const oneMinuteAgo = Date.now() - 60000;
    this.requestTimestamps = this.requestTimestamps.filter(ts => ts > oneMinuteAgo);

    // Record rotation history
    this.rotationHistory.push({
      modelId: model.id,
      provider: model.provider,
      group: groupType,
      strategy,
      costPer1K: model.costPer1K,
      priority: model.priority,
      timestamp: Date.now()
    });

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
    this._checkDailyRollover();
    this._checkHourlyRollover();

    this.dailyUsage.requests[modelId] = (this.dailyUsage.requests[modelId] || 0) + 1;
    this.dailyUsage.totalRequests++;
    this.dailyUsage.tokens[modelId] = (this.dailyUsage.tokens[modelId] || 0) + tokens;
    this.dailyUsage.totalTokens += tokens;
    this.dailyUsage.costs[modelId] = (this.dailyUsage.costs[modelId] || 0) + cost;
    this.dailyUsage.totalCost += cost;

    // Track hourly costs
    this.hourlyUsage.costs[modelId] = (this.hourlyUsage.costs[modelId] || 0) + cost;
    this.hourlyUsage.totalCost += cost;

    // Track request timestamp for rate limiting
    this.requestTimestamps.push(Date.now());

    // Track consecutive free requests
    if (cost === 0) {
      this.consecutiveFreeRequests++;
    } else {
      this.consecutiveFreeRequests = 0;
    }
    
    // Сброс ошибок при успешном использовании
    const status = this.modelStatus.get(modelId);
    if (status) {
      status.available = true;
      status.lastError = null;
      status.lastUsed = Date.now();
    } else {
      this.modelStatus.set(modelId, { available: true, lastUsed: Date.now() });
    }

    this._schedulePersist();
  }

  async _restoreStats() {
    try {
      const settings = await getSettings();
      const saved = settings.modelRouterStats;
      if (saved && saved.date === new Date().toDateString()) {
        this.dailyUsage = saved;
        console.log('[ModelRouter] Stats restored from DB');
      }
    } catch {}
  }

  _schedulePersist() {
    if (this._persistTimer) clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => {
      updateSettings({ modelRouterStats: this.dailyUsage }).catch(() => {});
    }, 5000);
  }

  /**
   * Сообщить о качестве ответа модели.
   * Если кракозяблы — модель уходит в cooldown и доступна следующая.
   * Возвращает true если текст битый.
   */
  reportResponseQuality(modelId, responseText) {
    if (!responseText || !modelId) return false;
    const isBad = this.checkResponseQuality(modelId, responseText);
    if (isBad) {
      this._log('info', `[Quality] ${modelId} → blocked (gibberish), selecting fallback`);
    }
    return isBad;
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
    const stats = {
      dailyUsage: this.dailyUsage,
      hourlyUsage: this.hourlyUsage,
      modelStatus: Object.fromEntries(this.modelStatus),
      rotationHistory: this.rotationHistory.slice(-50),
      lastRoulette: this.lastRouletteResults ? {
        time: this.lastRouletteTime,
        results: this.lastRouletteResults
      } : null,
      config: this.config,
      totalRequests: this.dailyUsage.totalRequests || Object.values(this.dailyUsage.requests).reduce((a, b) => a + b, 0),
      totalTokens: this.dailyUsage.totalTokens,
      totalCost: this.dailyUsage.totalCost,
      totalErrors: this.dailyUsage.totalErrors,
      rateLimitActive: this.config.rateLimiting?.enabled,
      rpmCurrent: this.requestTimestamps.filter(ts => ts > Date.now() - 60000).length,
      consecutiveFreeRequests: this.consecutiveFreeRequests
    };

    // Map modelStatus → modelHealth for dashboard compatibility
    stats.modelHealth = stats.modelStatus;

    return stats;
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

    // Пингуем только Ollama-модели через Ollama API.
    // Остальные провайдеры пропускаем — для них нужны отдельные эндпоинты.
    const ollamaModels = modelList.filter(m => m.provider === 'ollama');

    // Конкурентность: 3 Ollama модели одновременно
    const concurrencyLimit = 3;
    const chunks = [];
    for (let i = 0; i < ollamaModels.length; i += concurrencyLimit) {
      chunks.push(ollamaModels.slice(i, i + concurrencyLimit));
    }

    for (const chunk of chunks) {
      const promises = chunk.map(model => this._pingOllamaModel(model, testPrompt));
      const chunkResults = await Promise.allSettled(promises);
      
      for (const result of chunkResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
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

    // Для не-Ollama моделей добавляем запись "skipped"
    for (const model of modelList) {
      if (model.provider !== 'ollama') {
        results.push({
          modelId: model.id,
          groups: model.groups,
          provider: model.provider,
          success: false,
          latency: 0,
          status: 0,
          error: `Skipped — not an Ollama model (provider: ${model.provider})`,
        });
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
   * Пинг одной Ollama-модели через Ollama API
   */
  async _pingOllamaModel(model, testPrompt) {
    const startTime = Date.now();
    const modelId = model.id;
    const isCloud = modelId.includes(':cloud') || modelId.includes('-cloud');
    const cleanModelId = modelId.replace(/:(cloud|-cloud)$/i, '');
    const ollamaUrl = isCloud
      ? (process.env.OLLAMA_CLOUD_URL || 'https://ollama.com')
      : (this.config.ollama?.baseUrl || getOllamaBaseUrl());
    
    try {
      const response = await fetchWithTimeout(`${ollamaUrl}/api/chat`, {
        timeoutMs: 20000,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: cleanModelId,
          messages: [
            { role: 'user', content: testPrompt }
          ],
          stream: false,
          options: {
            num_predict: 10,
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
    const all = [];
    // Discover local models
    try {
      const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
      const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        for (const m of (data.models || [])) {
          const source = m.name.endsWith('-cloud') ? 'cloud' : 'local';
          const priority = inferPriority(m.name);
          const maxTokens = inferMaxTokens(m.name);
          const rateLimit = inferRateLimit(m.name);
          const groups = classifyModel(m.name);
          all.push({
            id: m.name,
            name: m.name,
            provider: 'ollama',
            source,
            priority,
            costPer1K: 0,
            tier: 'free',
            maxTokens,
            rateLimit,
            groups,
          });
        }
      }
    } catch { /* ignore */ }

    // Discover cloud models from Ollama Cloud API
    try {
      const cloudUrl = 'https://ollama.com/api/tags';
      const cloudRes = await fetch(cloudUrl, { signal: AbortSignal.timeout(5000) });
      if (cloudRes.ok) {
        const data = await cloudRes.json();
        for (const m of (data.models || [])) {
          const name = (m.name || m.id || m.model);
          if (!name) continue;
          const modelId = name.includes(':cloud') ? name : `${name}:cloud`;
          const priority = inferPriority(modelId);
          const maxTokens = inferMaxTokens(modelId);
          const rateLimit = inferRateLimit(modelId);
          const groups = classifyModel(name);
          all.push({
            id: modelId,
            name: modelId,
            provider: 'ollama',
            source: 'cloud',
            priority,
            costPer1K: 0,
            tier: 'free',
            maxTokens,
            rateLimit,
            groups,
          });
        }
      }
    } catch { /* ignore */ }

    return all;
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
   * Детект кракозяблов в тексте ответа модели.
   * Если доля нечитаемых Unicode-символов выше порога — текст битый.
   */
  _hasGibberish(text) {
    if (!text || text.length < 5) return false;
    const badRanges = [
      [0x0600, 0x06FF], // Arabic
      [0x0400, 0x04FF], // Cyrillic supplementary
      [0x0E00, 0x0E7F], // Thai
      [0x0F00, 0x0FFF], // Tibetan
      [0x2000, 0x206F], // General Punctuation
      [0xFFF0, 0xFFFF], // Specials
    ];
    let bad = 0;
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      for (const [lo, hi] of badRanges) {
        if (code >= lo && code <= hi) { bad++; break; }
      }
    }
    return bad > 0 && (bad / text.length) > 0.15;
  }

  /**
   * Проверить ответ модели на кракозяблы и временно заблокировать её если битая.
   * Возвращает true — если текст битый и модель ушла в cooldown.
   */
  checkResponseQuality(modelId, responseText) {
    if (!responseText || !modelId) return false;
    if (!this._hasGibberish(responseText)) return false;

    const status = this.modelStatus.get(modelId) || {};
    const now = Date.now();
    status.gibberishCount = (status.gibberishCount || 0) + 1;
    status.lastGibberish = now;
    status.lastError = 'gibberish output detected';
    status.lastErrorTime = now;

    // После 2-х кракозяблов подряд — cooldown 5 минут
    if (status.gibberishCount >= 2) {
      status.available = false;
      status.cooldownUntil = now + 300000;
      this.modelStatus.set(modelId, status);
      this._log('warn', `Model ${modelId} blacklisted (gibberish x${status.gibberishCount}), cooldown 5min`);
      return true;
    }

    this.modelStatus.set(modelId, status);
    this._log('warn', `Model ${modelId} produced gibberish (x${status.gibberishCount})`);
    return false;
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

  /**
   * Получить лучшую модель для задачи с приоритетом free
   */
  getBestModelForTask(taskType, options) {
    const opts = options || {};
    const preferFree = opts.preferFree !== false;
    const group = this.config.modelGroups[taskType];
    if (!group || !group.enabled || group.models.length === 0) return null;

    const available = group.models.filter(m => this._isModelAvailable(m.id));
    if (available.length === 0) {
      if (group.fallbackModel) return this._getModelById(group.fallbackModel, taskType);
      return group.models[0] || null;
    }

    const sorted = [...available].sort((a, b) => {
      if (preferFree) {
        const aFree = a.tier === 'free' || a.costPer1K === 0;
        const bFree = b.tier === 'free' || b.costPer1K === 0;
        if (aFree && !bFree) return -1;
        if (!aFree && bFree) return 1;
      }
      return a.priority - b.priority;
    });

    return sorted[0];
  }

  /**
   * Сохранить результаты сканера моделей, обновить конфиг и группы
   */
  setScannerResults(scoredModels) {
    if (!scoredModels || scoredModels.length === 0) return;

    const working = scoredModels.filter(m => m.status === 'ok' && m.avgScore > 0);

    this._scannerCache = {
      timestamp: Date.now(),
      models: scoredModels,
      total: scoredModels.length,
      working: working.length,
      bestFree: working
        .filter(m => m.tier === 'free' || m.costPer1K === 0)
        .sort((a, b) => (b.avgScore || 0) - (a.avgScore || 0))[0] || null,
      bestPaid: working
        .filter(m => m.tier !== 'free' && m.costPer1K > 0)
        .sort((a, b) => (b.avgScore || 0) - (a.avgScore || 0))[0] || null
    };

    // Обновление групп моделей в конфиге ModelRouter
    const groups = { chat: [], code: [], code_review: [], vision: [], web_search: [], embeddings: [] };
    for (const m of working) {
      const modelEntry = {
        id: m.model,
        provider: m.provider || 'opencode',
        priority: Math.round((1 - (m.avgScore || 0)) * 10) + 1,
        costPer1K: m.costPer1K || 0,
        tier: m.tier || (m.costPer1K === 0 ? 'free' : 'paid'),
      };
      const caps = m.capabilities || ['chat'];
      for (const cap of caps) {
        if (groups[cap]) {
          const exists = groups[cap].some(e => e.id === modelEntry.id && e.provider === modelEntry.provider);
          if (!exists) groups[cap].push(modelEntry);
        }
      }
      if (!caps.includes('vision') && !caps.includes('embeddings')) {
        const exists = groups.web_search.some(e => e.id === modelEntry.id && e.provider === modelEntry.provider);
        if (!exists) groups.web_search.push(modelEntry);
      }
    }

    for (const [name, models] of Object.entries(groups)) {
      const sorted = models
        .filter((m, i, arr) => arr.findIndex(x => x.id === m.id && x.provider === m.provider) === i)
        .sort((a, b) => {
          if (a.tier !== b.tier) return a.tier === 'free' ? -1 : 1;
          return a.priority - b.priority;
        });

      if (this.config.modelGroups[name]) {
        this.config.modelGroups[name].models = sorted;
        this.config.modelGroups[name].fallbackModel = sorted[0]?.id || null;
        this.config.modelGroups[name].enabled = sorted.length > 0;
      }
    }

    this._log('info', `Scanner results applied: ${working.length} working models in ${Object.keys(groups).length} groups`);
  }

  /**
   * Получить кеш результатов сканера
   */
  getScannerCache() {
    return this._scannerCache || null;
  }

  /**
   * Получить лучшую бесплатную модель для задачи
   */
  getBestFreeModel(taskType) {
    if (!taskType) taskType = 'chat';
    const model = this.getBestModelForTask(taskType, { preferFree: true });
    if (model && (model.tier === 'free' || model.costPer1K === 0)) return model;
    if (this._scannerCache?.bestFree) {
      const best = this._scannerCache.bestFree;
      return { id: best.model, provider: best.provider, tier: 'free' };
    }
    // Fallback: scan ALL groups for any free model
    for (const [name, group] of Object.entries(this.config.modelGroups)) {
      if (!group.enabled || !group.models.length) continue;
      const freeModel = group.models.find(m => m.tier === 'free' || m.costPer1K === 0);
      if (freeModel) return freeModel;
    }
    return null;
  }

  /**
   * Сообщить о качестве ответа модели. Если кракозяблы — cooldown.
   */
  reportResponseQuality(modelId, responseText) {
    if (!responseText || !modelId) return false;
    const isBad = this.checkResponseQuality(modelId, responseText);
    if (isBad) {
      this._log('info', `[Quality] ${modelId} → blocked (gibberish), selecting fallback`);
    }
    return isBad;
  }
}

// Синглтон
export const modelRouter = new ModelRouter();
export default ModelRouter;
