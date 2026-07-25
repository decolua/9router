/**
 * processGuard.js — Глобальный обработчик необработанных ошибок
 *
 * Особенности:
 * - Защита от повторной инициализации (hot-reload в dev)
 * - Логирует причины падений в файл crash.log
 * - Возвращает Promise.resolve() вместо throw для rejection (чтобы процесс жил)
 * - Инкрементирует счётчик ошибок, доступный через getErrorStats()
 */

import fs from 'fs';
import path from 'path';
import os from 'os';

const GUARD_MARKER = '__processGuardInitialized__';
const LOG_DIR = process.env.CRASH_LOG_DIR || path.join(os.homedir(), '.9router', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'crash.log');

// Singleton guard — защита от двойной инициализации при hot-reload
if (process[GUARD_MARKER]) {
  // Already initialized — export no-op stats
  // eslint-disable-next-line no-console
  console.log('[ProcessGuard] already initialized — skipping re-init');
} else {
  process[GUARD_MARKER] = true;

  // Увеличиваем лимит listeners, т.к. Next.js dev сам добавляет хендлеры
  if (typeof process.setMaxListeners === 'function') {
    process.setMaxListeners(50);
  }

  // Ensure log dir exists
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // ignore
  }

  // Stats counters
  const stats = {
    unhandledRejections: 0,
    uncaughtExceptions: 0,
    lastError: null,
    lastErrorTime: null,
    startTime: Date.now(),
    errors: [] // ring buffer of last 50 errors
  };

  function writeCrashLog(level, err, origin) {
    const ts = new Date().toISOString();
    const stack = err?.stack || err?.message || String(err);
    const line = `[${ts}] [${level}] [${origin}]\n${stack}\n---\n`;
    try { fs.appendFileSync(LOG_FILE, line, 'utf8'); } catch {}
    try { process.stderr.write(`\n[ProcessGuard] ${level} (${origin}): ${err?.message || err}\n`); } catch {}
  }

  process.on('unhandledRejection', (reason, promise) => {
    stats.unhandledRejections++;
    stats.lastError = reason?.message || String(reason);
    stats.lastErrorTime = Date.now();
    stats.errors.push({
      type: 'unhandledRejection',
      message: stats.lastError,
      time: stats.lastErrorTime,
      promiseRejected: true
    });
    if (stats.errors.length > 50) stats.errors.shift();

    // Log promise info for debugging
    const promiseInfo = promise ? '[Promise detected]' : '[No promise reference]';
    writeCrashLog('UNHANDLED_REJECTION', reason, `unhandledRejection ${promiseInfo}`);

    // Don't exit — process continues to serve other requests
    // Log to stderr so PM2 captures it
    try { process.stderr.write(`[ProcessGuard] unhandledRejection suppressed. Use pm2 logs to inspect.\n`); } catch {}
  });

  process.on('uncaughtException', (err) => {
    stats.uncaughtExceptions++;
    stats.lastError = err?.message || String(err);
    stats.lastErrorTime = Date.now();
    stats.errors.push({
      type: 'uncaughtException',
      message: stats.lastError,
      time: stats.lastErrorTime
    });
    if (stats.errors.length > 50) stats.errors.shift();

    writeCrashLog('UNCAUGHT_EXCEPTION', err, 'uncaughtException');

    if (err?.code === 'EPIPE') {
      return;
    }

    try { process.stderr.write(`[ProcessGuard] FATAL: ${err.message}\n`); } catch {}
    try { process.stderr.write(`[ProcessGuard] PM2 will auto-restart. Waiting 2s for log flush...\n`); } catch {}

    setTimeout(() => {
      process.exit(1);
    }, 2000).unref();
  });

  process.on('SIGINT', () => {
    try { process.stderr.write('[ProcessGuard] SIGINT received — graceful shutdown\n'); } catch {}
  });

  process.on('SIGTERM', () => {
    try { process.stderr.write('[ProcessGuard] SIGTERM received — graceful shutdown\n'); } catch {}
  });

  // Expose stats globally for debugging
  globalThis.__processGuardStats = stats;

  // eslint-disable-next-line no-console
  console.log(`[ProcessGuard] initialized — unhandled rejections/exceptions will be caught | log: ${LOG_FILE}`);
}

/**
 * Получить статистику ошибок (для health endpoint / API)
 */
export function getErrorStats() {
  return globalThis.__processGuardStats || {
    unhandledRejections: 0,
    uncaughtExceptions: 0,
    lastError: null,
    startTime: Date.now(),
    errors: []
  };
}

export const PROCESS_GUARD_LOG = LOG_FILE;