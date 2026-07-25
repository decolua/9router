/**
 * OpenCode Connect — интеграция OpenCode Free + OpenCode Go в оркестратор.
 *
 * OpenCode Free (oc): бесплатные модели, без авторизации
 *   - endpoint: https://opencode.ai/zen/v1
 *   - Динамический список моделей через /zen/v1/models
 *   - Используется для: chat, web_search, простой code_review
 *
 * OpenCode Go (ocg/opencode-go): платные модели, $5/mo
 *   - endpoint: https://opencode.ai/zen/go/v1
 *   - Фиксированный список: GLM 5.x, Kimi K2.x, DeepSeek, MiMo, MiniMax, Qwen
 *   - Используется для: code, vision, сложного code_review, supervisor
 *
 * Стратегия использования:
 *   - Simple chat → OpenCode Free (бесплатно)
 *   - Web search → OpenCode Free
 *   - Code gen → OpenCode Go (DeepSeek V4 Pro, Kimi K2.7 Code)
 *   - Code review → OpenCode Go (GLM 5.2, Qwen 3.7 Max)
 *   - Vision → OpenCode Go (MiniMax M3, Qwen 3.7 Plus)
 *   - Planning/Supervisor → OpenCode Go (DeepSeek V4 Flash)
 *   - Quality Gate → OpenCode Go (на дешёвой модели)
 */

const OPENCODE_FREE_BASE = 'https://opencode.ai/zen/v1';
const OPENCODE_GO_BASE = 'https://opencode.ai/zen/go/v1';

// OpenCode Go — известные модели с классификацией
// OpenCode Go — модели, тестированные с ключом PROVIDER_OPENCODE_KEY
export const OPENCODE_GO_MODELS = [
  // DeepSeek (cloud models)
  {
    id: 'deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    provider: 'opencode-go',
    priority: 1,
    costPer1K: 0.004,
    maxTokens: 65536,
    rateLimit: 60,
    cooldownMinutes: 0,
    groups: ['code', 'code_review', 'chat'],
    targetFormat: 'openai',
    tier: 'paid',
  },
  {
    id: 'deepseek-v4-flash',
    name: 'DeepSeek V4 Flash',
    provider: 'opencode-go',
    priority: 2,
    costPer1K: 0.001,
    maxTokens: 32768,
    rateLimit: 120,
    cooldownMinutes: 0,
    groups: ['chat', 'code', 'web_search'],
    targetFormat: 'openai',
    tier: 'paid',
  },
  
  // GLM
  {
    id: 'glm-5.2',
    name: 'GLM 5.2',
    provider: 'opencode-go',
    priority: 2,
    costPer1K: 0.003,
    maxTokens: 32768,
    rateLimit: 60,
    cooldownMinutes: 0,
    groups: ['chat', 'code_review'],
    targetFormat: 'openai',
    tier: 'paid',
  },
  {
    id: 'glm-5.1',
    name: 'GLM 5.1',
    provider: 'opencode-go',
    priority: 3,
    costPer1K: 0.002,
    maxTokens: 32768,
    rateLimit: 60,
    cooldownMinutes: 0,
    groups: ['chat', 'code_review'],
    targetFormat: 'openai',
    tier: 'paid',
  },
  
  // Kimi
  {
    id: 'kimi-k2.7-code',
    name: 'Kimi K2.7 Code',
    provider: 'opencode-go',
    priority: 1,
    costPer1K: 0.005,
    maxTokens: 65536,
    rateLimit: 60,
    cooldownMinutes: 0,
    groups: ['code', 'code_review'],
    targetFormat: 'openai',
    tier: 'paid',
  },
  {
    id: 'kimi-k2.6',
    name: 'Kimi K2.6',
    provider: 'opencode-go',
    priority: 3,
    costPer1K: 0.003,
    maxTokens: 32768,
    rateLimit: 60,
    cooldownMinutes: 0,
    groups: ['chat', 'web_search'],
    targetFormat: 'openai',
    tier: 'paid',
  },
  
  // MiMo
  {
    id: 'mimo-v2.5',
    name: 'MiMo V2.5',
    provider: 'opencode-go',
    priority: 4,
    costPer1K: 0.001,
    maxTokens: 16384,
    rateLimit: 120,
    cooldownMinutes: 0,
    groups: ['chat', 'web_search'],
    targetFormat: 'openai',
    tier: 'paid',
  },
  {
    id: 'mimo-v2.5-pro',
    name: 'MiMo V2.5 Pro',
    provider: 'opencode-go',
    priority: 3,
    costPer1K: 0.002,
    maxTokens: 32768,
    rateLimit: 60,
    cooldownMinutes: 0,
    groups: ['chat', 'code_review'],
    targetFormat: 'openai',
    tier: 'paid',
  },
  
  // MiniMax (vision models)
  {
    id: 'minimax-m3',
    name: 'MiniMax M3',
    provider: 'opencode-go',
    priority: 2,
    costPer1K: 0.004,
    maxTokens: 65536,
    rateLimit: 30,
    cooldownMinutes: 0,
    groups: ['chat', 'vision', 'code'],
    targetFormat: 'claude',
    tier: 'paid',
  },
  {
    id: 'minimax-m2.7',
    name: 'MiniMax M2.7',
    provider: 'opencode-go',
    priority: 3,
    costPer1K: 0.003,
    maxTokens: 32768,
    rateLimit: 30,
    cooldownMinutes: 0,
    groups: ['chat', 'vision'],
    targetFormat: 'claude',
    tier: 'paid',
  },
  {
    id: 'minimax-m2.5',
    name: 'MiniMax M2.5',
    provider: 'opencode-go',
    priority: 4,
    costPer1K: 0.002,
    maxTokens: 32768,
    rateLimit: 30,
    cooldownMinutes: 0,
    groups: ['chat', 'vision'],
    targetFormat: 'claude',
    tier: 'paid',
  },
  
  // Qwen
  {
    id: 'qwen3.7-max',
    name: 'Qwen 3.7 Max',
    provider: 'opencode-go',
    priority: 1,
    costPer1K: 0.006,
    maxTokens: 65536,
    rateLimit: 30,
    cooldownMinutes: 0,
    groups: ['code', 'code_review', 'chat', 'vision'],
    targetFormat: 'claude',
    tier: 'paid',
  },
  {
    id: 'qwen3.7-plus',
    name: 'Qwen 3.7 Plus',
    provider: 'opencode-go',
    priority: 2,
    costPer1K: 0.003,
    maxTokens: 32768,
    rateLimit: 60,
    cooldownMinutes: 0,
    groups: ['chat', 'vision', 'code_review'],
    targetFormat: 'claude',
    tier: 'paid',
  },
  {
    id: 'qwen3.6-plus',
    name: 'Qwen 3.6 Plus',
    provider: 'opencode-go',
    priority: 3,
    costPer1K: 0.002,
    maxTokens: 32768,
    rateLimit: 60,
    cooldownMinutes: 0,
    groups: ['chat', 'web_search'],
    targetFormat: 'claude',
    tier: 'paid',
  },
];

// Free-модели, известные как рабочие без ключа (no auth)
// Приоритет: самые дешёвые/быстрые сначала
export const OPENCODE_FREE_FALLBACK = [
  { id: 'north-mini-code-free', priority: 1, groups: ['chat', 'code', 'code_review', 'web_search'] },
  { id: 'deepseek-v4-flash-free', priority: 2, groups: ['chat', 'code', 'code_review', 'web_search'] },
  { id: 'big-pickle', priority: 3, groups: ['chat', 'code', 'web_search'] },
  { id: 'mimo-v2.5-free', priority: 4, groups: ['chat', 'web_search'] },
  { id: 'nemotron-3-ultra-free', priority: 4, groups: ['chat', 'web_search'] },
  // Vision-способные free модели (могут требовать ключ)
  { id: 'qwen3.6-plus-free', priority: 5, groups: ['chat', 'vision'] },
  { id: 'minimax-m3-free', priority: 5, groups: ['chat', 'vision'] },
];

// Free-модели, которые поддерживают vision (анализ изображений) без auth
const FREE_VISION_MODELS = new Set([
  'gemini-3-flash', 'gemini-3.1-pro', 'gemini-3.5-flash',
  'minimax-m3-free',
  'qwen3.6-plus-free',
]);

/**
 * Классифицировать free модель по имени в группы задач
 *
 * Claude Sonnet/Opus — ТОЛЬКО chat (как last resort), НЕ code/vision без явного запроса
 */
function classifyFreeModel(modelName) {
  const name = (modelName || '').toLowerCase();
  const groups = ['chat', 'web_search'];

  // Code-специализированные (deepseek-v4-flash-free, big-pickle, etc.)
  if (name.includes('codex') || name.includes('coder') || name.includes('code')) {
    groups.push('code');
    groups.push('code_review');
  }

  // DeepSeek — хорош для кода
  if (name.includes('deepseek')) {
    groups.push('code');
    groups.push('code_review');
  }

  // GPT-5 — codex варианты
  if (name.startsWith('gpt-5') || name.startsWith('gpt-5.')) {
    groups.push('code');
    groups.push('code_review');
    if (name.includes('codex')) groups.push('code_review');
  }

  // Gemini — универсальные (но могут требовать auth)
  if (name.startsWith('gemini')) {
    groups.push('code');
    groups.push('code_review');
    groups.push('vision');
  }

  // Kimi, GLM, Qwen, MiniMax, MiMo — бесплатные версии (Go models)
  // Используются как chat/code_review, не как vision (только с auth)
  if (name.startsWith('kimi') || name.startsWith('glm') || 
      name.includes('qwen') || name.includes('minimax') || name.includes('mimo')) {
    groups.push('code');
    groups.push('code_review');
  }

  // Vision-поддержка (free models that don't require auth)
  if (FREE_VISION_MODELS.has(modelName)) {
    groups.push('vision');
  }

  // Embedding
  if (name.includes('embed') || name.includes('nomic')) {
    groups.push('embeddings');
  }

  // Claude Sonnet/Opus/Fable — ТОЛЬКО chat, как last resort
  if (name.startsWith('claude') && (name.includes('sonnet') || name.includes('opus') || name.includes('fable'))) {
    // Можно использовать как chat, но НЕ code/vision/разметку автоматически
    groups.push('chat');
  }

  return [...new Set(groups)];
}

/**
 * Определить приоритет free модели
 *
 * Приоритет (FREE FIRST):
 *   1. Бесплатные модели, работающие без auth (north-mini-code-free, deepseek-v4-flash-free, big-pickle)
 *   2. Другие free модели, где может требоваться auth
 *   Claude Opus/Claude Sonnet — только как last resort
 *   GPT, Gemini, Grok — средний приоритет (могут требовать auth)
 */
function inferFreeModelPriority(modelName) {
  const name = (modelName || '').toLowerCase();

  // Бесплатные модели, работающие без auth
  if (name === 'north-mini-code-free' || name === 'north-mini-code') return 1;
  if (name === 'deepseek-v4-flash-free') return 2;
  if (name === 'big-pickle') return 3;
  if (name === 'mimo-v2.5-free' || name === 'nemotron-3-ultra-free') return 4;

  // OpenCode Go free-версии (могут требовать auth, но бесплатные по подписке)
  if (name.includes('-free')) return 5;

  // Gemini — сильные универсальные, используем если нет free
  if (name.startsWith('gemini')) return 6;

  // GPT-5 серия — средний приоритет
  if (name.startsWith('gpt-5') || name.startsWith('gpt-5.')) return 7;

  // Grok
  if (name.startsWith('grok')) return 8;

  // DeepSeek Go (требует ключ) — хорош для кода
  if (name === 'deepseek-v4-pro' || name === 'deepseek-v4-flash') return 9;

  // GLM, Kimi (Go, требуют ключ)
  if (name.startsWith('glm')) return 10;
  if (name.startsWith('kimi')) return 11;

  // Qwen, MiniMax, MiMo Go
  if (name.startsWith('qwen') || name.startsWith('minimax') || name.startsWith('mimo')) return 12;

  // Claude Haiku — дешёвый Claude
  if (name.includes('claude-haiku')) return 50;

  // Claude Sonnet — только last resort
  if (name.includes('claude-sonnet')) return 99;

  // Claude Opus/Fable — самый last resort, только для планирования
  if (name.includes('claude-opus') || name.includes('claude-fable')) return 100;

  // Неизвестные модели — низкий приоритет
  return 20;
}

/**
 * Определить maxTokens для free модели по имени
 */
function inferFreeModelMaxTokens(modelName) {
  const name = (modelName || '').toLowerCase();
  if (name.includes('claude') || name.includes('gemini-3.1')) return 65536;
  if (name.includes('deepseek') || name.includes('gpt-5.') || name.includes('grok')) return 32768;
  if (name.includes('gemini') || name.includes('kimi')) return 32768;
  return 16384;
}

/**
 * Получить все модели OpenCode через /zen/v1/models (free + paid ZEN)
 * Без фильтрации — возвращаем всё, что отдаёт API.
 * Сканер сам определит, какие работают, какие нет.
 */
export async function discoverOpenCodeFreeModels() {
  try {
    const response = await fetch(`${OPENCODE_FREE_BASE}/models`, {
      signal: AbortSignal.timeout(10000),
      headers: {
        'x-opencode-client': 'desktop',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(`[OpenCodeConnect] Models fetch failed: HTTP ${response.status}`);
      return buildFallbackModels();
    }

    const data = await response.json();
    let rawModels = data.data || data.models || data || [];
    if (!Array.isArray(rawModels)) rawModels = [];

    const models = rawModels
      .filter(m => m && m.id)
      .map(m => ({
        id: m.id,
        name: m.name || m.id,
        provider: m.id.includes('-free') || m.id.endsWith('-free') ? 'opencode' : 'opencode-go',
        priority: inferFreeModelPriority(m.id),
        costPer1K: (m.id.includes('-free') || m.id.endsWith('-free')) ? 0 : 0.001,
        maxTokens: inferFreeModelMaxTokens(m.id),
        rateLimit: 0,
        cooldownMinutes: 0,
        groups: classifyFreeModel(m.id),
        tier: (m.id.includes('-free') || m.id.endsWith('-free')) ? 'free' : 'paid',
        object: m.object || 'model',
      }));

    if (models.length === 0) {
      return buildFallbackModels();
    }

    // Сортируем по приоритету (меньше = выше приоритет)
    models.sort((a, b) => a.priority - b.priority);

    console.log(`[OpenCodeConnect] Discovered ${models.length} models from OpenCode`);
    return models;
  } catch (err) {
    console.warn(`[OpenCodeConnect] Models discovery failed: ${err.message}`);
    return buildFallbackModels();
  }
}

function buildFallbackModels() {
  const free = OPENCODE_FREE_FALLBACK.map(fb => ({
    id: fb.id,
    name: fb.id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    provider: 'opencode',
    priority: fb.priority || 5,
    costPer1K: 0,
    maxTokens: inferFreeModelMaxTokens(fb.id),
    rateLimit: 0,
    cooldownMinutes: 0,
    groups: fb.groups || ['chat', 'web_search'],
    tier: 'free',
  }));
  
  // Сортируем по priority (меньше = выше приоритет)
  free.sort((a, b) => a.priority - b.priority);
  return free;
}

/**
 * Проверить доступность OpenCode ключа
 */
export function hasOpenCodeGoKey() {
  return !!(process.env.PROVIDER_OPENCODE_KEY || '').trim();
}

// Кэш последних обнаруженных free моделей (заполняется из discoverOpenCodeFreeModels)
let _lastFreeModels = null;

/**
 * Получить доступные free модели (из кэша или fallback)
 */
export function getAvailableFreeModels() {
  if (_lastFreeModels && _lastFreeModels.length > 0) return _lastFreeModels;
  return buildFallbackModels();
}

/**
 * Установить кэш free моделей (вызывается после discovery)
 */
export function setFreeModelsCache(models) {
  _lastFreeModels = models;
}

// Приоритет выбора: free > go (бесплатные модели используются в первую очередь)
const FREE_FIRST = true;

/**
 * Получить id и provider для задачи, предпочитая free, затем Go
 */
function pickModel(taskType, requireVision, hasGoKey) {
  const freeModels = getAvailableFreeModels();
  let free = freeModels.find(m => m.groups.includes(taskType));
  if (!free && requireVision) {
    free = freeModels.find(m => m.groups.includes('vision'));
  }
  if (free && FREE_FIRST) {
    return { model: free.id, provider: 'opencode', tier: 'free' };
  }
  if (hasGoKey) {
    const go = OPENCODE_GO_MODELS.find(m => m.groups.includes(taskType));
    if (go) return { model: go.id, provider: 'opencode-go', tier: 'paid' };
    // Vision fallback Go
    if (requireVision) {
      const goVision = OPENCODE_GO_MODELS.find(m => m.groups.includes('vision'));
      if (goVision) return { model: goVision.id, provider: 'opencode-go', tier: 'paid' };
    }
  }
  if (free) {
    return { model: free.id, provider: 'opencode', tier: 'free' };
  }
  return null;
}

/**
 * Получить рекомендованную модель для задачи с учётом OpenCode
 *
 * Стратегия (FREE FIRST):
 *   - chat / web_search → free (бесплатно всегда)
 *   - code → free (если есть code-модель), иначе Go
 *   - code_review → free (если есть), иначе Go
 *   - vision → free (если модель поддерживает vision), иначе Go
 *   - embeddings/image_gen → Go (если есть ключ)
 *
 * @param {string} taskType - тип задачи
 * @param {object} context - контекст
 * @param {boolean} hasGoKey - есть ли OpenCode Go ключ
 * @returns {{model:string, provider:string, tier:string}|null}
 */
export function getRecommendedModel(taskType, context = {}, hasGoKey = false) {
  switch (taskType) {
    case 'chat':
    case 'web_search':
      return pickModel(taskType, false, hasGoKey);

    case 'code':
    case 'code_review':
      return pickModel(taskType, false, hasGoKey);

    case 'vision':
      return pickModel(taskType, true, hasGoKey);

    case 'embeddings':
    case 'image_gen':
    case 'orchestrate':
      if (!hasGoKey) return null;
      return pickModel(taskType, false, hasGoKey);

    default:
      return pickModel('chat', false, hasGoKey);
  }
}

/**
 * Получить эндпоинт для провайдера
 */
export function getEndpoint(provider) {
  if (provider === 'opencode' || provider === 'oc') return OPENCODE_FREE_BASE;
  if (provider === 'opencode-go' || provider === 'ocg') return OPENCODE_GO_BASE;
  return null;
}

/**
 * Получить заголовки для запроса к OpenCode
 */
export function getHeaders(provider, model) {
  if (provider === 'opencode' || provider === 'oc') {
    return {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer public',
      'x-opencode-client': 'desktop',
    };
  }

  if (provider === 'opencode-go' || provider === 'ocg') {
    const key = process.env.PROVIDER_OPENCODE_KEY || '';
    const modelEntry = OPENCODE_GO_MODELS.find(m => m.id === model);
    const useClaudeFormat = modelEntry?.targetFormat === 'claude';

    const headers = { 'Content-Type': 'application/json' };
    if (useClaudeFormat) {
      headers['x-api-key'] = key;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${key}`;
    }
    return headers;
  }

  return {};
}

/**
 * Выполнить запрос к OpenCode модели
 */
export async function callOpenCodeModel(provider, model, messages, options = {}) {
  const baseUrl = getEndpoint(provider);
  if (!baseUrl) throw new Error(`Unknown OpenCode provider: ${provider}`);

  const modelEntry = OPENCODE_GO_MODELS.find(m => m.id === model);
  const useMessagesEndpoint = modelEntry?.targetFormat === 'claude';
  const endpoint = useMessagesEndpoint
    ? `${baseUrl}/messages`
    : `${baseUrl}/chat/completions`;

  const headers = getHeaders(provider, model);
  const body = useMessagesEndpoint
    ? {
        model,
        messages,
        max_tokens: options.maxTokens || 4096,
        temperature: options.temperature ?? 0.3,
        stream: false,
      }
    : {
        model,
        messages,
        max_tokens: options.maxTokens || 4096,
        temperature: options.temperature ?? 0.3,
        stream: false,
      };

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs || 60000),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`OpenCode ${provider}/${model}: HTTP ${response.status} ${errText.substring(0, 200)}`);
    }

    const data = await response.json();

    if (useMessagesEndpoint) {
      return data.content?.[0]?.text || data.content || JSON.stringify(data);
    }

    return data.choices?.[0]?.message?.content || JSON.stringify(data);
  } catch (err) {
    if (err.name === 'TimeoutError') {
      throw new Error(`OpenCode ${provider}/${model} timeout after ${options.timeoutMs || 60000}ms`);
    }
    throw err;
  }
}
