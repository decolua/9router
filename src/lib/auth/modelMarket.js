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
    selectedModel: log.selectedModel || log.model,
    selectedModelType: log.selectedModelType || "模型",
    actualModel: log.actualModel || log.model,
    routerSelectedModel: log.routerSelectedModel || null,
    routerSelectedProvider: log.routerSelectedProvider || null,
    provider: log.provider,
    endpoint: log.endpoint,
    inputTokens: log.inputTokens,
    inputCost: log.inputCost,
    cacheReadTokens: log.cacheReadTokens,
    cacheReadCost: log.cacheReadCost,
    cacheCreationTokens: log.cacheCreationTokens,
    cacheCreationCost: log.cacheCreationCost,
    outputTokens: log.outputTokens,
    outputCost: log.outputCost,
    cost: log.cost,
    status: log.status,
    latencyMs: log.latencyMs,
  };
}
