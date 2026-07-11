#!/usr/bin/env node
/**
 * Seed-скрипт для добавления/обновления провайдеров в БД.
 *
 * Запуск:
 *   node scripts/seed-providers.js
 *   npm run seed
 *
 * Ключи читаются из файла .env в корне проекта.
 * Формат .env:
 *   PROVIDER_ROUTERAI_KEY=sk-...
 *   PROVIDER_ROUTERAI_KEY2=sk-...
 *   PROVIDER_OPENCODE_KEY=sk-...
 *   PROVIDER_CLOUDFLARE_KEY=cfut_...
 *   PROVIDER_CLOUDFLARE_KEY2=cfk_...
 *   PROVIDER_9ROUTER_KEY=sk-...
 *   PROVIDER_VERCEL_KEY=vcp_...
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- Парсинг .env вручную (без dotenv) ----------
function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.log('.env файл не найден. Создайте .env в корне проекта.');
    return {};
  }

  const content = fs.readFileSync(envPath, 'utf-8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Убираем кавычки
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

// ---------- Поиск БД ----------
function findDbPath() {
  const candidates = [
    path.join(process.env.APPDATA || '', '9router', 'db', 'data.sqlite'),
    path.join(process.env.HOME || '', '.9router', 'db', 'data.sqlite'),
    path.join(process.env.HOME || '', '9router', 'db', 'data.sqlite'),
    path.join(__dirname, '..', 'data-home', 'db', 'data.sqlite'),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0]; // вернём первый как дефолтный
}

// ---------- MAIN ----------
const env = loadEnv();

const providers = [
  { provider: 'routerai',  name: 'RouterAI',  key: env.PROVIDER_ROUTERAI_KEY,  key2: env.PROVIDER_ROUTERAI_KEY2 },
  { provider: 'opencode',  name: 'OpenCode',  key: env.PROVIDER_OPENCODE_KEY },
  { provider: 'cloudflare-ai',name: 'Cloudflare',key: env.PROVIDER_CLOUDFLARE_KEY, key2: env.PROVIDER_CLOUDFLARE_KEY2 },
  { provider: '9router',   name: '9Router',   key: env.PROVIDER_9ROUTER_KEY },
  { provider: 'vercel-ai-gateway',name: 'Vercel',key: env.PROVIDER_VERCEL_KEY },
  { provider: 'xai',       name: 'xAI (Grok)', key: env.PROVIDER_XAI_KEY },
  { provider: 'groq',      name: 'Groq',       key: env.PROVIDER_GROQ_KEY },
  { provider: 'ai21',      name: 'AI21 Jamba', key: env.PROVIDER_AI21_KEY },
  { provider: 'upstage',   name: 'Upstage',    key: env.PROVIDER_UPSTAGE_KEY },
].filter(p => p.key);

if (providers.length === 0) {
  console.log('Нет ключей в .env файле.');
  console.log('Создайте .env со строками вида:');
  console.log('  PROVIDER_ROUTERAI_KEY=sk-...');
  console.log('  PROVIDER_OPENCODE_KEY=sk-...');
  console.log('  ...');
  console.log('\nПример уже есть в корне проекта (.env).');
  process.exit(0);
}

const dbPath = findDbPath();
console.log('DB:', dbPath);

if (!fs.existsSync(dbPath)) {
  console.log('База данных не найдена. Убедитесь, что 9Router запущен хотя бы раз.');
  process.exit(1);
}

const db = new Database(dbPath);

const existing = db.prepare('SELECT provider FROM providerConnections').all();
const existingProviders = new Set(existing.map(r => r.provider));

const insert = db.prepare(`
  INSERT OR IGNORE INTO providerConnections (id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
  VALUES (?, ?, ?, ?, NULL, ?, 1, ?, ?, ?)
`);
const update = db.prepare(`
  UPDATE providerConnections SET data = ?, updatedAt = ?, name = ?, isActive = 1 WHERE provider = ?
`);

const now = new Date().toISOString();
let added = 0, updated = 0;

const run = db.transaction((items) => {
  for (const p of items) {
    const data = JSON.stringify({
      apiKey: p.key,
      secondaryKey: p.key2 || '',
      testStatus: 'pending',
      providerSpecificData: {
        connectionProxyEnabled: false,
        connectionProxyUrl: '',
        connectionNoProxy: ''
      }
    });

    if (existingProviders.has(p.provider)) {
      update.run(data, now, p.name, p.provider);
      updated++;
      console.log(`✓ Updated: ${p.name} (${p.provider})`);
    } else {
      insert.run(crypto.randomUUID(), p.provider, 'apikey', p.name, 1 + added, data, now, now);
      added++;
      console.log(`✓ Added: ${p.name} (${p.provider})`);
    }
  }
});

run(providers);
console.log(`\nDone: ${added} added, ${updated} updated`);

const all = db.prepare('SELECT provider, name, isActive FROM providerConnections ORDER BY priority').all();
console.log('\n=== ACTIVE PROVIDERS ===');
all.forEach(r => console.log(`  [${r.provider}] ${r.name}: active=${r.isActive}`));

db.close();