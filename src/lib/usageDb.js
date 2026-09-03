// Shim → re-export from new SQLite-based DB layer (src/lib/db/)
export {
  statsEmitter, trackPendingRequest, getActiveRequests,
  saveRequestUsage, getUsageHistory, getUsageStats, getChartData,
  appendRequestLog, getRecentLogs,
  saveRequestDetail, getRequestDetails, getRequestDetailById,
  setAntigravityVerification, clearAntigravityVerification, getAntigravityVerification, getAllAntigravityVerifications,
} from "@/lib/db/index.js";
