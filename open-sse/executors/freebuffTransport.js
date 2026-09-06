import { FETCH_CONNECT_TIMEOUT_MS, DEFAULT_RETRY_CONFIG, resolveRetryEntry } from "../config/runtimeConfig.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { hasTrustedRelayFailure, markFreebuffPoolFailure } from "./freebuffProxyFitness.js";

export function sessionCacheKey(token, model) { return `${token}::${model}`; }
export async function fetchWithNetworkRetry(url, options, proxyOptions, attempts = 3, timeoutMs = FETCH_CONNECT_TIMEOUT_MS) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await proxyAwareFetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) }, proxyOptions); }
    catch (error) { lastError = error; if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 750)); }
  }
  throw lastError;
}
export function freebuffRetryConfig(config) { return { ...DEFAULT_RETRY_CONFIG, ...config.retry }; }
export function createFreebuffChat({ buildBody, url, headers, proxyOptions, model, signal, timeoutMs, retryConfig }) {
  return async () => {
    let networkAttempts = 0;
    for (let attempt = 0; ; attempt += 1) {
      const transformedBody = buildBody(); const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error("fetch connect timeout")), timeoutMs || FETCH_CONNECT_TIMEOUT_MS);
      const mergedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      let response;
      try { response = await proxyAwareFetch(url, { method: "POST", headers, body: JSON.stringify(transformedBody), signal: mergedSignal }, proxyOptions); }
      catch (error) {
        if (signal?.aborted || error?.responseStarted) throw error;
        if (networkAttempts >= 2) {
          const provenance = controller.signal.aborted ? "timeout_before_response" : "proxy_connect";
          const poolScoped = await markFreebuffPoolFailure({ model, proxyOptions, stage: "chat_submit", error, provenance, signal });
          if (poolScoped) error.poolScoped = poolScoped;
          throw error;
        }
        networkAttempts += 1; await new Promise((resolve) => setTimeout(resolve, 750)); continue;
      } finally { clearTimeout(timer); }
      if (hasTrustedRelayFailure(response)) { const error = Object.assign(new Error(`Freebuff relay failed: ${response.status}`), { status: response.status }); const poolScoped = await markFreebuffPoolFailure({ model, proxyOptions, stage: "chat_submit", status: response.status, error, provenance: "relay_internal" }); if (poolScoped) error.poolScoped = poolScoped; throw error; }
      const retry = resolveRetryEntry(retryConfig[response.status]);
      if (retry && attempt < retry.attempts) { await new Promise((resolve) => setTimeout(resolve, retry.delayMs)); continue; }
      return { response, transformedBody };
    }
  };
}
