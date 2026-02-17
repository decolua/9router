// Stub for cloud worker - no-op async functions
export async function saveRequestUsage() { }
export function trackPendingRequest() { }
export async function appendRequestLog() { }
export async function saveRequestDetail() { }
export async function getUsageDb() { return { data: { history: [] } }; }
export async function getUsageHistory() { return []; }
export async function getUsageStats() { return {}; }
export async function getRecentLogs() { return []; }
