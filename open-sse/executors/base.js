import { HTTP_STATUS, RETRY_CONFIG, DEFAULT_RETRY_CONFIG, resolveRetryEntry, FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { shouldRefreshCredentials } from "../services/oauthCredentialManager.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { dbg } from "../utils/debugLog.js";
import { ANTHROPIC_API_VERSION, OPENAI_COMPAT_BASE, ANTHROPIC_COMPAT_BASE } from "../providers/shared.js";
import { resolveOpenAICompatibleApiType } from "../services/provider.js";

/**
 * BaseExecutor - Base class for provider executors
 */
function parseDurationToMs(durationStr) {
  if (!durationStr || typeof durationStr !== "string") return null;
  
  // Format 1: "547098.015490101s" (seconds only, with decimals)
  const secondsMatch = durationStr.match(/^([\d.]+)\s*s$/i);
  if (secondsMatch) {
    const secs = parseFloat(secondsMatch[1]);
    return isNaN(secs) ? null : Math.round(secs * 1000);
  }

  // Format 2: "151h58m18.015490101s" (hours, minutes, seconds with decimals)
  const match = durationStr.match(/(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:([\d.]+)s)?/i);
  if (!match) return null;

  let totalMs = 0;
  if (match[1]) totalMs += parseInt(match[1], 10) * 3600 * 1000;
  if (match[2]) totalMs += parseInt(match[2], 10) * 60 * 1000;
  if (match[3]) totalMs += Math.round(parseFloat(match[3]) * 1000);

  return totalMs > 0 ? totalMs : null;
}

export class BaseExecutor {
  constructor(provider, config) {
    this.provider = provider;
    this.config = config;
    this.noAuth = config?.noAuth || false;
  }

  getProvider() {
    return this.provider;
  }

  getBaseUrls() {
    return this.config.baseUrls || (this.config.baseUrl ? [this.config.baseUrl] : []);
  }

  getFallbackCount() {
    return this.getBaseUrls().length || 1;
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    if (this.provider?.startsWith?.("openai-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || OPENAI_COMPAT_BASE;
      const normalized = baseUrl.replace(/\/$/, "");
      const path = resolveOpenAICompatibleApiType(this.provider, credentials) === "responses" ? "/responses" : "/chat/completions";
      return `${normalized}${path}`;
    }
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || ANTHROPIC_COMPAT_BASE;
      const normalized = baseUrl.replace(/\/$/, "");
      return `${normalized}/messages`;
    }
    const baseUrls = this.getBaseUrls();
    return baseUrls[urlIndex] || baseUrls[0] || this.config.baseUrl;
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      ...this.config.headers
    };

    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      // Anthropic-compatible providers use x-api-key header
      if (credentials.apiKey) {
        headers["x-api-key"] = credentials.apiKey;
      } else if (credentials.accessToken) {
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      }
      if (!headers["anthropic-version"]) {
        headers["anthropic-version"] = ANTHROPIC_API_VERSION;
      }
    } else {
      // Standard Bearer token auth for other providers
      if (credentials.accessToken) {
        headers["Authorization"] = `Bearer ${credentials.accessToken}`;
      } else if (credentials.apiKey) {
        headers["Authorization"] = `Bearer ${credentials.apiKey}`;
      }
    }

    if (stream) {
      headers["Accept"] = "text/event-stream";
    }

    return headers;
  }

  // Override in subclass for provider-specific transformations
  transformRequest(model, body, stream, credentials) {
    return body;
  }

  shouldRetry(status, urlIndex) {
    return status === HTTP_STATUS.RATE_LIMITED && urlIndex + 1 < this.getFallbackCount();
  }

  // Override in subclass for provider-specific refresh
  async refreshCredentials(credentials, log, proxyOptions = null) {
    return null;
  }

  needsRefresh(credentials) {
    return shouldRefreshCredentials(this.provider, credentials);
  }

  parseError(response, bodyText) {
    let message = bodyText || `HTTP ${response.status}`;
    let resetsAtMs = null;

    if (bodyText) {
      try {
        const json = JSON.parse(bodyText);
        message = json.error?.message || json.message || json.error || message;

        // Parse Google RPC error details
        const details = json?.error?.details;
        if (Array.isArray(details)) {
          for (const d of details) {
            // ErrorInfo: quotaResetTimeStamp (ISO) or quotaResetDelay
            if (d?.["@type"] === "type.googleapis.com/google.rpc.ErrorInfo") {
              if (d.reason) {
                if (!message.includes(d.reason)) {
                  message += ` [${d.reason}]`;
                }
              }
              const metadata = d.metadata;
              if (metadata) {
                if (metadata.quotaResetTimeStamp) {
                  const t = new Date(metadata.quotaResetTimeStamp).getTime();
                  if (!isNaN(t) && t > Date.now()) {
                    resetsAtMs = t;
                  }
                }
                if (!resetsAtMs && metadata.quotaResetDelay) {
                  const delayMs = parseDurationToMs(metadata.quotaResetDelay);
                  if (delayMs) {
                    resetsAtMs = Date.now() + delayMs;
                  }
                }
              }
            }
            // RetryInfo: retryDelay
            if (!resetsAtMs && d?.["@type"] === "type.googleapis.com/google.rpc.RetryInfo" && d?.retryDelay) {
              const delayMs = parseDurationToMs(d.retryDelay);
              if (delayMs) {
                resetsAtMs = Date.now() + delayMs;
              }
            }
          }
        }
      } catch {
        // ignore parse error
      }
    }

    // Try to parse from message string using regex (e.g. "Resets in 151h58m18s" or "reset after 2h7m23s")
    if (!resetsAtMs && message && typeof message === "string" && response.status === 429) {
      const match = message.match(/reset(?:s)?\s+(?:after|in)\s+(\d+h)?\s*(\d+m)?\s*(\d+s)?/i);
      if (match) {
        let totalMs = 0;
        if (match[1]) totalMs += parseInt(match[1], 10) * 3600 * 1000;
        if (match[2]) totalMs += parseInt(match[2], 10) * 60 * 1000;
        if (match[3]) totalMs += parseInt(match[3], 10) * 1000;
        if (totalMs > 0) {
          resetsAtMs = Date.now() + totalMs;
        }
      }
    }

    return {
      status: response.status,
      message,
      ...(resetsAtMs && { resetsAtMs })
    };
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const fallbackCount = this.getFallbackCount();
    let lastError = null;
    let lastStatus = 0;
    const retryAttemptsByUrl = {};

    // Merge default retry config with provider-specific config
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry };

    // Schedule retry via retryConfig[statusKey]. Returns true when caller should `urlIndex--; continue`
    // response (optional) lets a subclass hook compute a dynamic delay (e.g. antigravity Retry-After).
    const tryRetry = async (urlIndex, statusKey, reason, response = null) => {
      const { attempts, delayMs } = resolveRetryEntry(retryConfig[statusKey]);
      if (attempts <= 0 || retryAttemptsByUrl[urlIndex] >= attempts) return false;
      // Hook: subclass may derive delay from the response (headers/body). null → skip retry, use fallback.
      let waitMs = delayMs;
      if (response && this.computeRetryDelay) {
        const dynamic = await this.computeRetryDelay(response, retryAttemptsByUrl[urlIndex] + 1, delayMs);
        if (dynamic === false) return false; // hook vetoes retry (e.g. Retry-After too long)
        if (dynamic != null) waitMs = dynamic;
      }
      retryAttemptsByUrl[urlIndex]++;
      log?.debug?.("RETRY", `${reason} retry ${retryAttemptsByUrl[urlIndex]}/${attempts} after ${waitMs / 1000}s`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
      return true;
    };

    for (let urlIndex = 0; urlIndex < fallbackCount; urlIndex++) {
      const url = this.buildUrl(model, stream, urlIndex, credentials);
      const transformedBody = this.transformRequest(model, body, stream, credentials);
      const headers = this.buildHeaders(credentials, stream, url, model);

      if (!retryAttemptsByUrl[urlIndex]) retryAttemptsByUrl[urlIndex] = 0;

      // Abort if upstream doesn't return response headers within connection timeout
      const connectCtrl = new AbortController();
      const timeoutMs = this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS;
      const connectTimer = setTimeout(() => connectCtrl.abort(new Error("fetch connect timeout")), timeoutMs);
      const mergedSignal = signal ? AbortSignal.any([signal, connectCtrl.signal]) : connectCtrl.signal;

      try {
        const bodyStr = JSON.stringify(transformedBody);
        const fetchT0 = Date.now();
        dbg("FETCH", `${this.provider.toUpperCase()} → ${url} | body=${bodyStr.length}B | connectTimeout=${timeoutMs}ms`);
        const response = await proxyAwareFetch(url, {
          method: "POST",
          headers,
          body: bodyStr,
          signal: mergedSignal
        }, proxyOptions);
        clearTimeout(connectTimer);
        const ct = response.headers?.get?.("content-type") || "";
        const cl = response.headers?.get?.("content-length") || "?";
        dbg("FETCH", `${this.provider.toUpperCase()} ← ${response.status} | ttft=${Date.now() - fetchT0}ms | ct=${ct} | cl=${cl}`);

        if (await tryRetry(urlIndex, response.status, `status ${response.status}`, response)) { urlIndex--; continue; }

        if (this.shouldRetry(response.status, urlIndex)) {
          log?.debug?.("RETRY", `${response.status} on ${url}, trying fallback ${urlIndex + 1}`);
          lastStatus = response.status;
          continue;
        }

        return { response, url, headers, transformedBody };
      } catch (error) {
        clearTimeout(connectTimer);
        lastError = error;
        const isConnectTimeout = connectCtrl.signal.aborted && error.name === "AbortError";
        dbg("FETCH", `${this.provider.toUpperCase()} ✖ ${error.name}: ${error.message}${isConnectTimeout ? " (connect timeout)" : ""}`);
        // Connect timeout is internal — convert to retryable network error, don't propagate AbortError
        if (error.name === "AbortError" && !isConnectTimeout) throw error;

        // Map network/fetch exceptions to 502 retry config
        if (await tryRetry(urlIndex, HTTP_STATUS.BAD_GATEWAY, `network "${error.message}"`)) { urlIndex--; continue; }

        if (urlIndex + 1 < fallbackCount) {
          log?.debug?.("RETRY", `Error on ${url}, trying fallback ${urlIndex + 1}`);
          continue;
        }
        throw error;
      }
    }

    throw lastError || new Error(`All ${fallbackCount} URLs failed with status ${lastStatus}`);
  }
}

export default BaseExecutor;
