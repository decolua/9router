#!/usr/bin/env node
/**
 * Настройка 9Router для локального использования с LM Studio, OpenRouter, Ollama, OpenCode.
 *
 * Запуск: node scripts/setup-local.js
 *
 * Что делает:
 * 1. Добавляет LM Studio (http://127.0.0.1:1234) как ProviderNode + Connection
 * 2. Добавляет OpenRouter (API ключ) как ProviderConnection
 * 3. Настраивает оркестратор на free-first режим
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Читаем .env для ключей
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf-8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const env = loadEnv();
const OPENROUTER_KEY = env.PROVIDER_OPENROUTER_KEY || '';

// ---------- Поиск БД ----------
function findDbPath() {
  const candidates = [
    '/app/data/db/data.sqlite',
    path.join(__dirname, '..', 'data', 'db', 'data.sqlite'),
    path.join(process.env.APPDATA || '', '9router', 'db', 'data.sqlite'),
    path.join(process.env.HOME || '', '.9router', 'db', 'data.sqlite'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // Если БД не найдена — создаём в первом кандидате
  const defaultDb = candidates[0];
  const dbDir = path.dirname(defaultDb);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
    console.log('  (created dir):', dbDir);
  }
  // Создаём пустую БД — next dev создаст схему при старте
  try {
    const temp = new Database(defaultDb);
    temp.close();
    console.log('  (created empty DB):', defaultDb);
  } catch (e) {
    console.log('  (db init warn):', e.message);
  }
  return defaultDb;
}

// ---------- MAIN ----------
const dbPath = findDbPath();
console.log('DB:', dbPath);

if (!fs.existsSync(dbPath)) {
  console.log('\nБаза данных не найдена. Запустите 9Router хотя бы раз:');
  console.log('  npm run dev\n');
  console.log('База создастся автоматически при первом запуске.');
  console.log('После этого запустите скрипт снова:\n');
  console.log('  node scripts/setup-local.js\n');
  process.exit(1);
}

const db = new Database(dbPath);
const now = new Date().toISOString();

let changes = 0;

// ===================== 1. LM Studio =====================
console.log('\n--- LM Studio (http://127.0.0.1:1234) ---');

// Проверяем, есть ли уже нода
const existingLMStudio = db.prepare(
  "SELECT id FROM providerNodes WHERE name = 'LM Studio'"
).get();

let lmStudioNodeId;
if (!existingLMStudio) {
  lmStudioNodeId = `openai-compatible-chat-${crypto.randomUUID().slice(0, 8)}`;
  db.prepare(
    `INSERT INTO providerNodes (id, type, name, data, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    lmStudioNodeId,
    'openai-compatible',
    'LM Studio',
    JSON.stringify({
      baseUrl: 'http://127.0.0.1:1234',
      prefix: 'lm-studio',
      apiType: 'chat',
    }),
    now, now
  );
  console.log(`  ✓ Создан ProviderNode: ${lmStudioNodeId}`);
  changes++;
} else {
  lmStudioNodeId = existingLMStudio.id;
  console.log(`  ✓ Уже существует: ${lmStudioNodeId} (пропускаем)`);
}

// Проверяем, есть ли уже connection для LM Studio
const existingConn = db.prepare(
  "SELECT id FROM providerConnections WHERE provider = ?"
).get(lmStudioNodeId);

if (!existingConn) {
  db.prepare(
    `INSERT INTO providerConnections (id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, NULL, ?, 1, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    lmStudioNodeId,
    'apikey',
    'LM Studio',
    10,
    JSON.stringify({
      apiKey: '',
      testStatus: 'unknown',
      providerSpecificData: {
        prefix: 'lm-studio',
        apiType: 'chat',
        baseUrl: 'http://127.0.0.1:1234',
        nodeName: 'LM Studio',
        connectionProxyEnabled: false,
        connectionProxyUrl: '',
        connectionNoProxy: ''
      }
    }),
    now, now
  );
  console.log('  ✓ Создано ProviderConnection для LM Studio');
  changes++;
} else {
  console.log('  ✓ Connection уже существует (пропускаем)');
}

// ===================== 2. OpenRouter =====================
console.log('\n--- OpenRouter ---');

const existingOR = db.prepare(
  "SELECT id FROM providerConnections WHERE provider = 'openrouter'"
).get();

if (!existingOR) {
  db.prepare(
    `INSERT INTO providerConnections (id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
     VALUES (?, 'openrouter', 'apikey', 'OpenRouter', NULL, 5, 1, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    JSON.stringify({
      apiKey: OPENROUTER_KEY,
      testStatus: 'unknown',
      providerSpecificData: {
        connectionProxyEnabled: false,
        connectionProxyUrl: '',
        connectionNoProxy: ''
      }
    }),
    now, now
  );
  console.log('  ✓ Создано ProviderConnection для OpenRouter');
  changes++;
} else {
  console.log('  ✓ OpenRouter уже настроен (пропускаем)');
}

// ===================== 3. Настройки оркестратора =====================
console.log('\n--- Оркестратор ---');

try {
  const existingSettings = db.prepare(
    "SELECT data FROM settings WHERE id = 1"
  ).get();

  const settingsData = existingSettings ? JSON.parse(existingSettings.data || '{}') : {};

  const orchestratorSettings = {
    supervisorProvider: 'opencode',
    supervisorModel: 'deepseek-v4-flash-free',
    supervisorEndpoint: 'https://opencode.ai/zen/v1',
    supervisorMaxTokens: 2000,
    supervisorTemperature: 0.3,
    reviewProvider: 'opencode',
    reviewModel: 'north-mini-code-free',
    reviewEndpoint: 'https://opencode.ai/zen/v1',
    reviewMaxTokens: 500,
    reviewTemperature: 0.2,
    maxRetries: 2,
    minQualityScore: 0.5,
  };

  settingsData.orchestrator = orchestratorSettings;

  db.prepare(
    `INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`
  ).run(JSON.stringify(settingsData));

  console.log('  ✓ Настройки оркестратора обновлены');
  console.log('    Supervisor: opencode/deepseek-v4-flash-free');
  console.log('    QualityGate: opencode/north-mini-code-free');
  changes++;
} catch (err) {
  console.log('  ✗ Ошибка обновления настроек:', err.message);
}

// ===================== Итог =====================
console.log(`\n========== ГОТОВО (${changes} изменений) ==========`);
console.log('\nТеперь запустите сервер:');
console.log('  npm run dev\n');
console.log('Дашборд: http://localhost:20128');
console.log('OpenAI endpoint: http://localhost:20128/v1');
console.log('Оркестратор: POST http://localhost:20128/api/orchestrator');
console.log('\nПодключенные провайдеры:');
console.log('  ✓ OpenCode Free (бесплатно): north-mini-code-free, deepseek-v4-flash-free, big-pickle, mimo-v2.5-free, nemotron-3-ultra-free');
console.log('  ✓ OpenCode Go (по ключу): deepseek-v4-pro, deepseek-v4-flash, kimi-k2.7-code, glm-5.2, minimax-m3, qwen3.7-max');
console.log('  ✓ Ollama (авто-обнаружение): gemma4, qwen3.6, qwen2.5vl, gemma2, qwen2.5-coder');
console.log('  ✓ LM Studio (http://127.0.0.1:1234): ваши локальные модели');
console.log('  ✓ OpenRouter (sk-or-v1-...): 300+ моделей');

db.close();
