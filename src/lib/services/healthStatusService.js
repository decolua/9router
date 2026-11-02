import os from "node:os";

/**
 * Build consolidated health status report for 9Router.
 * Evaluates host system metrics, provider connectivity states, and configured combos.
 *
 * @param {object} deps Injected dependencies for testability
 * @returns {Promise<object>}
 */
export async function buildHealthStatus(deps = {}) {
  const getConnections = deps.getConnections || (async () => {
    const { getProviderConnections } = await import("@/lib/db/repos/connectionsRepo.js");
    return getProviderConnections();
  });

  const getCombos = deps.getCombos || (async () => {
    const { getCombos: fetchCombos } = await import("@/lib/db/repos/combosRepo.js");
    return fetchCombos();
  });

  const version = deps.version || process.env.npm_package_version || "0.5.112";

  // System stats via native Node.js APIs
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memoryUsagePercent = totalMem > 0 ? Number((((totalMem - freeMem) / totalMem) * 100).toFixed(1)) : 0;
  const processMemoryMb = Number((process.memoryUsage().rss / (1024 * 1024)).toFixed(1));
  const cpus = os.cpus() || [];

  const [connections, combos] = await Promise.all([
    getConnections().catch(() => []),
    getCombos().catch(() => []),
  ]);

  const now = Date.now();
  const providers = {};
  let totalActive = 0;
  let totalDegraded = 0;
  let totalUnhealthy = 0;

  for (const conn of connections) {
    const p = conn.provider || "unknown";
    if (!providers[p]) {
      providers[p] = {
        status: "healthy",
        activeConnections: 0,
        totalConnections: 0,
        rateLimited: false,
        lastError: null,
      };
    }

    providers[p].totalConnections += 1;
    if (conn.isActive) {
      providers[p].activeConnections += 1;
      totalActive += 1;

      const isRateLimited = Boolean(conn.rateLimitedUntil && conn.rateLimitedUntil > now);
      if (isRateLimited) {
        providers[p].rateLimited = true;
      }

      if (conn.testStatus === "error" || conn.lastError) {
        providers[p].lastError = conn.lastError;
      }

      if (conn.testStatus === "error") {
        providers[p].status = "unhealthy";
        totalUnhealthy += 1;
      } else if (isRateLimited || conn.lastError) {
        if (providers[p].status !== "unhealthy") {
          providers[p].status = "degraded";
        }
        totalDegraded += 1;
      }
    }
  }

  // Summary status determination
  let overallStatus = "healthy";
  if (totalActive > 0 && totalUnhealthy === totalActive) {
    overallStatus = "unhealthy";
  } else if (totalDegraded > 0 || totalUnhealthy > 0) {
    overallStatus = "degraded";
  }

  const combosSummary = {};
  for (const combo of combos) {
    const models = Array.isArray(combo.models) ? combo.models : [];
    combosSummary[combo.name || combo.id] = {
      status: models.length > 0 ? "active" : "empty",
      modelCount: models.length,
      models,
    };
  }

  return {
    status: overallStatus,
    timestamp: new Date().toISOString(),
    version,
    uptime: Math.floor(process.uptime()),
    system: {
      memoryUsagePercent,
      processMemoryMb,
      cpuCores: cpus.length,
      platform: os.platform(),
      nodeVersion: process.version,
    },
    providers,
    combos: combosSummary,
  };
}
