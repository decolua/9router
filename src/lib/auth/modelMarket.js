export function extractModelMarketApiKey(request) {
  const authorization = request.headers.get("authorization") || "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7).trim();
  return (request.headers.get("x-api-key") || "").trim();
}

export function sanitizeModelMarketLog(log) {
  return {
    id: log.id,
    timestamp: log.timestamp,
    model: log.model,
    provider: log.provider,
    endpoint: log.endpoint,
    inputTokens: log.inputTokens,
    cacheReadTokens: log.cacheReadTokens,
    cacheCreationTokens: log.cacheCreationTokens,
    outputTokens: log.outputTokens,
    cost: log.cost,
    status: log.status,
    latencyMs: log.latencyMs,
  };
}
