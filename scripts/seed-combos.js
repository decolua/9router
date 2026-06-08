/**
 * Seed combos — создаёт комбинации моделей в БД.
 *
 * Запуск внутри Docker:
 *   docker cp scripts/seed-combos.js 9router-app-1:/app/seed-combos.js
 *   docker exec 9router-app-1 node /app/seed-combos.js
 *
 * Ключи берутся из переменных окружения контейнера (из .env файла).
 */
const Database = require('better-sqlite3');
const crypto = require('crypto');
const db = new Database('/app/data/db/data.sqlite');
const now = new Date().toISOString();

// Get provider IDs from DB
const provIds = {};
db.prepare('SELECT id, provider FROM providerConnections').all().forEach(r => { provIds[r.provider] = r.id; });
console.log('Providers:', Object.keys(provIds).join(', '));

if (Object.keys(provIds).length === 0) {
  console.log('No providers found. Run seed-providers.js first.');
  db.close();
  process.exit(1);
}

// Clear old combos
db.prepare('DELETE FROM combos').run();

const combos = [
  // --- FREE MIX ---
  { name: 'free-mix', kind: 'llm', providers: ['routerai', 'routerai', 'routerai', 'cloudflare', 'routerai'],
    models: ['deepseek/deepseek-v4-flash', 'google/gemma-4-27b-it', 'qwen/qwen3-30b-a3b', 'meta-llama/llama-3.3-70b-instruct', 'mistralai/mistral-small-latest'] },
  // --- DeepSeek ---
  { name: 'deepseek-v4-flash', kind: 'llm', providers: ['routerai', '9router'], models: ['deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-flash'] },
  { name: 'deepseek-chat', kind: 'llm', providers: ['routerai', 'opencode', '9router'], models: ['deepseek/deepseek-chat', 'deepseek/deepseek-chat', 'deepseek/deepseek-chat'] },
  { name: 'deepseek-reasoner', kind: 'llm', providers: ['routerai', '9router'], models: ['deepseek/deepseek-reasoner', 'deepseek/deepseek-reasoner'] },
  // --- Claude ---
  { name: 'claude-sonnet-4', kind: 'llm', providers: ['routerai', 'opencode', 'vercel'], models: ['anthropic/claude-sonnet-4-20250514', 'anthropic/claude-sonnet-4-20250514', 'anthropic/claude-sonnet-4-20250514'] },
  { name: 'claude-3.5-sonnet', kind: 'llm', providers: ['routerai', 'opencode'], models: ['anthropic/claude-3.5-sonnet', 'anthropic/claude-3.5-sonnet'] },
  { name: 'claude-3.5-haiku', kind: 'llm', providers: ['routerai', 'opencode'], models: ['anthropic/claude-3-5-haiku-20241022', 'anthropic/claude-3-5-haiku-20241022'] },
  // --- GPT ---
  { name: 'gpt-4o', kind: 'llm', providers: ['routerai', 'opencode', 'vercel'], models: ['openai/gpt-4o', 'openai/gpt-4o', 'openai/gpt-4o'] },
  { name: 'gpt-4o-mini', kind: 'llm', providers: ['routerai', 'opencode'], models: ['openai/gpt-4o-mini', 'openai/gpt-4o-mini'] },
  { name: 'gpt-4.1', kind: 'llm', providers: ['routerai', 'opencode'], models: ['openai/gpt-4.1', 'openai/gpt-4.1'] },
  { name: 'gpt-4.1-mini', kind: 'llm', providers: ['routerai', 'opencode'], models: ['openai/gpt-4.1-mini', 'openai/gpt-4.1-mini'] },
  { name: 'o3-mini', kind: 'llm', providers: ['routerai', 'opencode'], models: ['openai/o3-mini', 'openai/o3-mini'] },
  // --- Google ---
  { name: 'gemini-2.5-flash', kind: 'llm', providers: ['routerai', 'opencode'], models: ['google/gemini-2.5-flash-preview', 'google/gemini-2.5-flash-preview'] },
  { name: 'gemini-2.5-pro', kind: 'llm', providers: ['routerai', 'opencode'], models: ['google/gemini-2.5-pro-preview', 'google/gemini-2.5-pro-preview'] },
  { name: 'gemini-2.0-flash', kind: 'llm', providers: ['routerai'], models: ['google/gemini-2.0-flash-001'] },
  // --- Meta ---
  { name: 'llama-4-maverick', kind: 'llm', providers: ['routerai', 'cloudflare'], models: ['meta-llama/llama-4-maverick', 'meta-llama/llama-4-maverick'] },
  { name: 'llama-4-scout', kind: 'llm', providers: ['routerai', 'cloudflare'], models: ['meta-llama/llama-4-scout', 'meta-llama/llama-4-scout'] },
  // --- Qwen ---
  { name: 'qwen3-235b', kind: 'llm', providers: ['routerai', 'opencode'], models: ['qwen/qwen3-235b-a22b', 'qwen/qwen3-235b-a22b'] },
  { name: 'qwen3-30b', kind: 'llm', providers: ['routerai'], models: ['qwen/qwen3-30b-a3b'] },
  // --- Mistral ---
  { name: 'mistral-large', kind: 'llm', providers: ['routerai'], models: ['mistralai/mistral-large-latest'] },
  { name: 'codestral', kind: 'llm', providers: ['routerai'], models: ['mistralai/codestral-latest'] },
  // --- Vision ---
  { name: 'gpt-4o-vision', kind: 'vision', providers: ['routerai'], models: ['openai/gpt-4o'] },
  { name: 'gemini-flash-vision', kind: 'vision', providers: ['routerai'], models: ['google/gemini-2.5-flash-preview'] },
  // --- Image Gen ---
  { name: 'dall-e-3', kind: 'image', providers: ['routerai'], models: ['openai/dall-e-3'] },
  // --- Embeddings ---
  { name: 'text-embedding-3-small', kind: 'embeddings', providers: ['routerai'], models: ['openai/text-embedding-3-small'] },
  // --- Free ---
  { name: 'gemma-4-27b', kind: 'llm', providers: ['routerai'], models: ['google/gemma-4-27b-it'] },
  { name: 'llama-3.3-70b', kind: 'llm', providers: ['cloudflare'], models: ['meta-llama/llama-3.3-70b-instruct'] },
];

const insert = db.prepare('INSERT INTO combos (id, name, kind, models, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)');

db.transaction(() => {
  for (const combo of combos) {
    const models = combo.models.map((model, i) => ({
      provider: combo.providers[i],
      connectionId: provIds[combo.providers[i]] || '',
      model,
      priority: i + 1,
    }));
    insert.run(crypto.randomUUID(), combo.name, combo.kind, JSON.stringify(models), now, now);
    console.log('  + ' + combo.kind.padEnd(12) + combo.name + ' (' + models.length + ' providers)');
  }
})();

console.log('\nTotal: ' + combos.length + ' combos created');
db.close();
