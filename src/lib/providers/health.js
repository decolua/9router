/**
 * Provider health check module.
 * Checks the health of provider API endpoints by making test requests.
 */

import { PROVIDERS } from "open-sse/providers/index.js";

export async function getProviderHealth(providerId = null) {
  const providers = providerId
    ? { [providerId]: PROVIDERS[providerId] }
    : PROVIDERS;

  const results = {};

  for (const [id, config] of Object.entries(providers)) {
    if (!config || !config.baseUrl) continue;

    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(config.baseUrl, {
        method: "GET",
        signal: controller.signal,
        headers: {
          "Accept": "application/json",
          "User-Agent": "9Router-HealthCheck/1.0"
        }
      }).catch(() => null);

      clearTimeout(timeout);

      results[id] = {
        status: response?.ok ? "reachable" : "unreachable",
        latency: Date.now() - start,
        statusCode: response?.status || 0,
        provider: config.name || id
      };
    } catch {
      results[id] = {
        status: "error",
        latency: Date.now() - start,
        statusCode: 0,
        provider: config.name || id
      };
    }
  }

  return results;
}