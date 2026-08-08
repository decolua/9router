/**
 * Prometheus Metrics Service for 9Router
 * Exposes operational metrics for monitoring, alerting, and observability
 */

import { Registry, Counter, Histogram, Gauge } from 'prom-client';

// Create registry with default labels
const registry = new Registry();
registry.setDefaultLabels({ 
  app: '9router', 
  version: process.env.npm_package_version || 'unknown' 
});

/**
 * Metrics Collection
 * All metrics are registered with the registry for /metrics endpoint
 */
export const metrics = {
  // ============================================
  // REQUEST METRICS
  // ============================================
  
  requestsTotal: new Counter({
    name: 'ninerouter_requests_total',
    help: 'Total number of requests processed',
    labelNames: ['model', 'provider', 'status', 'format'],
    registers: [registry]
  }),

  requestDuration: new Histogram({
    name: 'ninerouter_request_duration_seconds',
    help: 'Request latency in seconds',
    labelNames: ['model', 'provider', 'format'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
    registers: [registry]
  }),

  requestSize: new Histogram({
    name: 'ninerouter_request_size_bytes',
    help: 'Request payload size in bytes',
    labelNames: ['model', 'provider'],
    buckets: [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
    registers: [registry]
  }),

  responseSize: new Histogram({
    name: 'ninerouter_response_size_bytes',
    help: 'Response payload size in bytes',
    labelNames: ['model', 'provider'],
    buckets: [100, 500, 1000, 5000, 10000, 50000, 100000, 500000, 1000000],
    registers: [registry]
  }),

  // ============================================
  // TOKEN METRICS
  // ============================================

  tokensTotal: new Counter({
    name: 'ninerouter_tokens_total',
    help: 'Total tokens consumed',
    labelNames: ['model', 'provider', 'type'], // type: prompt|completion|total
    registers: [registry]
  }),

  tokenUsage: new Histogram({
    name: 'ninerouter_token_usage',
    help: 'Token usage per request',
    labelNames: ['model', 'provider', 'type'],
    buckets: [10, 50, 100, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000, 128000],
    registers: [registry]
  }),

  // ============================================
  // FALLBACK METRICS
  // ============================================

  fallbackTotal: new Counter({
    name: 'ninerouter_fallback_total',
    help: 'Number of fallback triggers',
    labelNames: ['from_model', 'to_model', 'reason'], // reason: rate_limit|error|quota|timeout|circuit_open
    registers: [registry]
  }),

  fallbackChainLength: new Histogram({
    name: 'ninerouter_fallback_chain_length',
    help: 'Number of models tried before success',
    labelNames: ['combo'],
    buckets: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    registers: [registry]
  }),

  // ============================================
  // CONNECTION METRICS
  // ============================================

  activeConnections: new Gauge({
    name: 'ninerouter_active_connections',
    help: 'Number of active SSE connections',
    labelNames: ['endpoint'],
    registers: [registry]
  }),

  connectionDuration: new Histogram({
    name: 'ninerouter_connection_duration_seconds',
    help: 'SSE connection duration',
    labelNames: ['endpoint'],
    buckets: [1, 5, 10, 30, 60, 300, 600, 1800, 3600],
    registers: [registry]
  }),

  // ============================================
  // RTK (TOKEN SAVER) METRICS
  // ============================================

  rtkCompressionRatio: new Histogram({
    name: 'ninerouter_rtk_compression_ratio',
    help: 'RTK compression percentage (0-1)',
    labelNames: ['model', 'provider'],
    buckets: [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5],
    registers: [registry]
  }),

  rtkCompressionHits: new Counter({
    name: 'ninerouter_rtk_compression_hits_total',
    help: 'Number of successful RTK compressions',
    labelNames: ['model', 'provider', 'filter'],
    registers: [registry]
  }),

  rtkBytesSaved: new Counter({
    name: 'ninerouter_rtk_bytes_saved_total',
    help: 'Total bytes saved by RTK compression',
    labelNames: ['model', 'provider'],
    registers: [registry]
  }),

  // ============================================
  // CIRCUIT BREAKER METRICS
  // ============================================

  circuitBreakerState: new Gauge({
    name: 'ninerouter_circuit_breaker_state',
    help: 'Circuit breaker state (0=closed, 1=half-open, 2=open)',
    labelNames: ['provider'],
    registers: [registry]
  }),

  circuitBreakerFailures: new Counter({
    name: 'ninerouter_circuit_breaker_failures_total',
    help: 'Total failures recorded by circuit breaker',
    labelNames: ['provider', 'error_type'],
    registers: [registry]
  }),

  circuitBreakerStateChanges: new Counter({
    name: 'ninerouter_circuit_breaker_state_changes_total',
    help: 'Circuit breaker state transitions',
    labelNames: ['provider', 'from_state', 'to_state'],
    registers: [registry]
  }),

  // ============================================
  // RATE LIMITER METRICS
  // ============================================

  rateLimiterTokens: new Gauge({
    name: 'ninerouter_rate_limiter_tokens_available',
    help: 'Available tokens in rate limiter bucket',
    labelNames: ['provider', 'model'],
    registers: [registry]
  }),

  rateLimiterCapacity: new Gauge({
    name: 'ninerouter_rate_limiter_bucket_capacity',
    help: 'Rate limiter bucket capacity',
    labelNames: ['provider', 'model'],
    registers: [registry]
  }),

  rateLimitRejected: new Counter({
    name: 'ninerouter_rate_limit_rejected_total',
    help: 'Requests rejected by rate limiter',
    labelNames: ['provider', 'model'],
    registers: [registry]
  }),

  rateLimiterRetryAfter: new Histogram({
    name: 'ninerouter_rate_limiter_retry_after_seconds',
    help: 'Seconds until next request allowed',
    labelNames: ['provider', 'model'],
    buckets: [1, 2, 5, 10, 30, 60, 120, 300],
    registers: [registry]
  }),

  // ============================================
  // PROVIDER HEALTH METRICS
  // ============================================

  providerHealth: new Gauge({
    name: 'ninerouter_provider_health',
    help: 'Provider health status (1=healthy, 0.5=degraded, 0=unhealthy)',
    labelNames: ['provider'],
    registers: [registry]
  }),

  providerLatency: new Histogram({
    name: 'ninerouter_provider_latency_seconds',
    help: 'Provider health check latency',
    labelNames: ['provider', 'depth'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10],
    registers: [registry]
  }),

  providerUptime: new Gauge({
    name: 'ninerouter_provider_uptime_ratio',
    help: 'Provider uptime ratio (0-1)',
    labelNames: ['provider'],
    registers: [registry]
  }),

  healthCheckTotal: new Counter({
    name: 'ninerouter_health_checks_total',
    help: 'Total health checks performed',
    labelNames: ['provider', 'status'],
    registers: [registry]
  }),

  // ============================================
  // CACHE METRICS
  // ============================================

  cacheHits: new Counter({
    name: 'ninerouter_cache_hits_total',
    help: 'Cache hits',
    labelNames: ['endpoint'],
    registers: [registry]
  }),

  cacheMisses: new Counter({
    name: 'ninerouter_cache_misses_total',
    help: 'Cache misses',
    labelNames: ['endpoint'],
    registers: [registry]
  }),

  cacheSize: new Gauge({
    name: 'ninerouter_cache_size',
    help: 'Current cache entries',
    labelNames: ['endpoint'],
    registers: [registry]
  }),

  cacheHitRate: new Gauge({
    name: 'ninerouter_cache_hit_rate',
    help: 'Cache hit rate (0-1)',
    labelNames: ['endpoint'],
    registers: [registry]
  }),

  // ============================================
  // COST METRICS
  // ============================================

  costTotal: new Counter({
    name: 'ninerouter_cost_usd_total',
    help: 'Total estimated cost in USD',
    labelNames: ['provider', 'model', 'free'],
    registers: [registry]
  }),

  costPerRequest: new Histogram({
    name: 'ninerouter_cost_per_request_usd',
    help: 'Cost per request',
    labelNames: ['provider', 'model'],
    buckets: [0, 0.0001, 0.001, 0.01, 0.1, 1, 10],
    registers: [registry]
  }),

  budgetUtilization: new Gauge({
    name: 'ninerouter_budget_utilization_ratio',
    help: 'Budget utilization (0-1)',
    labelNames: ['budget_name'],
    registers: [registry]
  }),

  freeRatio: new Gauge({
    name: 'ninerouter_free_request_ratio',
    help: 'Ratio of free requests',
    labelNames: ['window'],
    registers: [registry]
  }),

  // ============================================
  // WEBHOOK METRICS
  // ============================================

  webhookDeliveries: new Counter({
    name: 'ninerouter_webhook_deliveries_total',
    help: 'Webhook delivery attempts',
    labelNames: ['webhook_id', 'event', 'status'],
    registers: [registry]
  }),

  webhookFailures: new Counter({
    name: 'ninerouter_webhook_failures_total',
    help: 'Webhook delivery failures',
    labelNames: ['webhook_id', 'event', 'error'],
    registers: [registry]
  }),

  // ============================================
  // ERROR METRICS
  // ============================================

  errorsTotal: new Counter({
    name: 'ninerouter_errors_total',
    help: 'Total errors by type',
    labelNames: ['provider', 'model', 'error_type', 'error_code'],
    registers: [registry]
  }),

  // ============================================
  // SYSTEM METRICS
  // ============================================

  uptime: new Gauge({
    name: 'ninerouter_uptime_seconds',
    help: 'Application uptime in seconds',
    registers: [registry]
  }),

  memoryUsage: new Gauge({
    name: 'ninerouter_memory_usage_bytes',
    help: 'Memory usage in bytes',
    labelNames: ['type'], // heap, rss, external
    registers: [registry]
  }),

  cpuUsage: new Gauge({
    name: 'ninerouter_cpu_usage_microseconds',
    help: 'CPU usage in microseconds (user + system)',
    registers: [registry]
  })
};

/**
 * Helper functions for recording metrics
 */

export function recordRequest({ model, provider, status, format, durationMs, promptTokens, completionTokens, requestBytes, responseBytes }) {
  const labels = { model, provider, status, format };
  metrics.requestsTotal.inc(labels);
  
  if (durationMs) {
    metrics.requestDuration.observe({ model, provider, format }, durationMs / 1000);
  }
  
  if (requestBytes) {
    metrics.requestSize.observe({ model, provider }, requestBytes);
  }
  
  if (responseBytes) {
    metrics.responseSize.observe({ model, provider }, responseBytes);
  }
  
  if (promptTokens) {
    metrics.tokensTotal.inc({ model, provider, type: 'prompt' }, promptTokens);
    metrics.tokenUsage.observe({ model, provider, type: 'prompt' }, promptTokens);
  }
  
  if (completionTokens) {
    metrics.tokensTotal.inc({ model, provider, type: 'completion' }, completionTokens);
    metrics.tokenUsage.observe({ model, provider, type: 'completion' }, completionTokens);
  }
  
  metrics.tokensTotal.inc({ model, provider, type: 'total' }, (promptTokens || 0) + (completionTokens || 0));
}

export function recordFallback({ fromModel, toModel, reason }) {
  metrics.fallbackTotal.inc({ from_model: fromModel, to_model: toModel, reason });
}

export function recordFallbackChain({ combo, length }) {
  metrics.fallbackChainLength.observe({ combo }, length);
}

export function recordRTK({ model, provider, ratio, filter, bytesSaved }) {
  if (ratio !== undefined) {
    metrics.rtkCompressionRatio.observe({ model, provider }, ratio);
  }
  if (filter) {
    metrics.rtkCompressionHits.inc({ model, provider, filter });
  }
  if (bytesSaved) {
    metrics.rtkBytesSaved.inc({ model, provider }, bytesSaved);
  }
}

export function recordCircuitBreaker({ provider, state, fromState, toState, errorType }) {
  const stateMap = { closed: 0, 'half-open': 1, open: 2 };
  if (state !== undefined) {
    metrics.circuitBreakerState.set({ provider }, stateMap[state] ?? 0);
  }
  if (errorType) {
    metrics.circuitBreakerFailures.inc({ provider, error_type: errorType });
  }
  if (fromState && toState) {
    metrics.circuitBreakerStateChanges.inc({ provider, from_state: fromState, to_state: toState });
  }
}

export function recordRateLimiter({ provider, model, tokens, capacity, rejected, retryAfter }) {
  if (tokens !== undefined) {
    metrics.rateLimiterTokens.set({ provider, model }, tokens);
  }
  if (capacity !== undefined) {
    metrics.rateLimiterCapacity.set({ provider, model }, capacity);
  }
  if (rejected) {
    metrics.rateLimitRejected.inc({ provider, model });
  }
  if (retryAfter) {
    metrics.rateLimiterRetryAfter.observe({ provider, model }, retryAfter);
  }
}

export function recordProviderHealth({ provider, status, latency, uptime }) {
  const statusMap = { healthy: 1, degraded: 0.5, unhealthy: 0, unknown: -1 };
  metrics.providerHealth.set({ provider }, statusMap[status] ?? -1);
  
  if (latency) {
    metrics.providerLatency.observe({ provider, depth: 'standard' }, latency);
  }
  
  if (uptime !== undefined) {
    metrics.providerUptime.set({ provider }, uptime);
  }
}

export function recordHealthCheck({ provider, status }) {
  metrics.healthCheckTotal.inc({ provider, status });
}

export function recordCache({ endpoint, hit, size, hitRate }) {
  if (hit) {
    metrics.cacheHits.inc({ endpoint });
  } else {
    metrics.cacheMisses.inc({ endpoint });
  }
  if (size !== undefined) {
    metrics.cacheSize.set({ endpoint }, size);
  }
  if (hitRate !== undefined) {
    metrics.cacheHitRate.set({ endpoint }, hitRate);
  }
}

export function recordCost({ provider, model, cost, free }) {
  metrics.costTotal.inc({ provider, model, free: free ? 'true' : 'false' }, cost);
  if (cost > 0) {
    metrics.costPerRequest.observe({ provider, model }, cost);
  }
}

export function recordBudget({ budgetName, utilization }) {
  metrics.budgetUtilization.set({ budget_name: budgetName }, utilization);
}

export function recordFreeRatio({ window, ratio }) {
  metrics.freeRatio.set({ window }, ratio);
}

export function recordWebhook({ webhookId, event, status, error }) {
  if (status === 'success') {
    metrics.webhookDeliveries.inc({ webhook_id: webhookId, event, status });
  } else {
    metrics.webhookDeliveries.inc({ webhook_id: webhookId, event, status: 'failure' });
    metrics.webhookFailures.inc({ webhook_id: webhookId, event, error: error || 'unknown' });
  }
}

export function recordError({ provider, model, errorType, errorCode }) {
  metrics.errorsTotal.inc({ provider, model, error_type: errorType, error_code: errorCode || 'unknown' });
}

export function recordActiveConnections({ endpoint, count }) {
  metrics.activeConnections.set({ endpoint }, count);
}

export function recordConnectionDuration({ endpoint, durationMs }) {
  metrics.connectionDuration.observe({ endpoint }, durationMs / 1000);
}

export function recordSystemMetrics() {
  const mem = process.memoryUsage();
  metrics.memoryUsage.set({ type: 'heap' }, mem.heapUsed);
  metrics.memoryUsage.set({ type: 'rss' }, mem.rss);
  metrics.memoryUsage.set({ type: 'external' }, mem.external);
  metrics.uptime.set(process.uptime());

  // CPU usage (approximate - user + system time in microseconds)
  const cpu = process.cpuUsage();
  const totalCpuMs = (cpu.user + cpu.system) / 1000;
  metrics.cpuUsage.set(totalCpuMs);
}

/**
 * Export metrics in Prometheus format
 */
export async function getMetrics() {
  return registry.metrics();
}

export function getContentType() {
  return registry.contentType;
}

export { registry };

// Start system metrics collection interval
let systemMetricsInterval = null;

export function startSystemMetricsCollection(intervalMs = 10000) {
  if (systemMetricsInterval) return;
  systemMetricsInterval = setInterval(recordSystemMetrics, intervalMs);
  // Run immediately
  recordSystemMetrics();
}

export function stopSystemMetricsCollection() {
  if (systemMetricsInterval) {
    clearInterval(systemMetricsInterval);
    systemMetricsInterval = null;
  }
}