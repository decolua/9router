// Shim: re-exports from the TypeScript implementation.
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageStats, getChartData,
  appendRequestLog, getRecentLogs,
  getMonthlyUsageForKey, getMonthlyUsageBreakdownForKey,
} from "./usageRepo.ts";
