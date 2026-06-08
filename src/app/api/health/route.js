import { getErrorStats, PROCESS_GUARD_LOG } from '@/lib/processGuard.js';
import { supervisor } from '@/orchestrator/supervisor.js';

/**
 * GET /api/health
 * Возвращает состояние сервера + статистику ошибок для мониторинга
 * и отладки причин падений.
 */
export async function GET() {
  const stats = getErrorStats();
  const uptime = process.uptime();
  const mem = process.memoryUsage();

  return Response.json({
    status: 'ok',
    uptime: {
      seconds: Math.floor(uptime),
      human: formatUptime(uptime),
      startTime: stats.startTime
    },
    process: {
      pid: process.pid,
      nodeVersion: process.version,
      platform: process.platform
    },
    memory: {
      rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)}MB`
    },
    errors: {
      unhandledRejections: stats.unhandledRejections,
      uncaughtExceptions: stats.uncaughtExceptions,
      lastError: stats.lastError,
      lastErrorTime: stats.lastErrorTime,
      lastErrorAge: stats.lastErrorTime
        ? `${Math.floor((Date.now() - stats.lastErrorTime) / 1000)}s ago`
        : null,
      recent: stats.errors.slice(-10) // last 10 errors
    },
    supervisor: {
      activeWorkflows: supervisor.getActiveWorkflowCount?.() ?? 0
    },
    crashLogPath: PROCESS_GUARD_LOG
  });
}

function formatUptime(sec) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${h}h ${m}m ${s}s`;
}