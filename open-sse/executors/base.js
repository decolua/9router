import { HTTP_STATUS, RETRY_CONFIG } from "../config/runtimeConfig.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

/**
 * BaseExecutor - Base class for provider executors
 *
 * Supports per-provider proxy configuration via credentials.proxy:
 * {
 *   url: "http://user:pass@proxy.com:8080" | "socks5://proxy.com:1080",
 *   bypass: ["*.local", "localhost"]
 * }
 */
export class BaseExecutor {
  constructor(provider, config) {
    this.provider = provider;
    this.config = config;
  }

  /**
   * Get proxy agent for request
   *
   * Checks provider-specific proxy config first, falls back to global env vars.
   * Respects bypass patterns from both provider config and NO_PROXY env var.
   *
   * @param {string} targetUrl - Target URL
   * @param {object} credentials - Provider credentials (may include proxy config)
   * @returns {Promise<Agent|null>} Proxy agent or null (for direct connection)
   */
  /**
   * Build per-provider proxy options from credentials
   * @param {object} credentials - Provider credentials (may include proxy config)
   * @returns {object|null} Proxy options for proxyAwareFetch
   */
  getProviderProxyOptions(credentials = {}) {
    const proxyConfig = credentials.proxy;
    if (!proxyConfig?.url) return null;
    return {
      enabled: true,
      url: proxyConfig.url,
      noProxy: Array.isArray(proxyConfig.bypass) ? proxyConfig.bypass.join(',') : '',
    };
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
      const baseUrl = credentials?.providerSpecificData?.baseUrl || "https://api.openai.com/v1";
      const normalized = baseUrl.replace(/\/$/, "");
      const path = this.provider.includes("responses") ? "/responses" : "/chat/completions";
      return `${normalized}${path}`;
    }
    const baseUrls = this.getBaseUrls();
    return baseUrls[urlIndex] || baseUrls[0] || this.config.baseUrl;
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      ...this.config.headers
    };

    if (credentials.accessToken) {
      headers["Authorization"] = `Bearer ${credentials.accessToken}`;
    } else if (credentials.apiKey) {
      headers["Authorization"] = `Bearer ${credentials.apiKey}`;
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
  async refreshCredentials(credentials, log) {
    return null;
  }

  needsRefresh(credentials) {
    if (!credentials.expiresAt) return false;
    const expiresAtMs = new Date(credentials.expiresAt).getTime();
    return expiresAtMs - Date.now() < 5 * 60 * 1000;
  }

  parseError(response, bodyText) {
    return { status: response.status, message: bodyText || `HTTP ${response.status}` };
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }) {
    const fallbackCount = this.getFallbackCount();
    let lastError = null;
    let lastStatus = 0;
    const retryAttemptsByUrl = {};

    for (let urlIndex = 0; urlIndex < fallbackCount; urlIndex++) {
      const url = this.buildUrl(model, stream, urlIndex, credentials);
      const transformedBody = this.transformRequest(model, body, stream, credentials);
      const headers = this.buildHeaders(credentials, stream);

      if (!retryAttemptsByUrl[urlIndex]) retryAttemptsByUrl[urlIndex] = 0;

      // Build per-provider proxy options (merged with global proxyOptions)
      const providerProxy = this.getProviderProxyOptions(credentials);
      const effectiveProxyOptions = providerProxy || proxyOptions;

      try {
        const response = await proxyAwareFetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(transformedBody),
          signal
        }, effectiveProxyOptions);

        // Retry 429 with fixed delay before falling back to next URL
        if (response.status === HTTP_STATUS.RATE_LIMITED && retryAttemptsByUrl[urlIndex] < RETRY_CONFIG.maxAttempts) {
          retryAttemptsByUrl[urlIndex]++;
          log?.debug?.("RETRY", `429 retry ${retryAttemptsByUrl[urlIndex]}/${RETRY_CONFIG.maxAttempts} after ${RETRY_CONFIG.delayMs / 1000}s`);
          await new Promise(resolve => setTimeout(resolve, RETRY_CONFIG.delayMs));
          urlIndex--;
          continue;
        }

        if (this.shouldRetry(response.status, urlIndex)) {
          log?.debug?.("RETRY", `${response.status} on ${url}, trying fallback ${urlIndex + 1}`);
          lastStatus = response.status;
          continue;
        }

        return { response, url, headers, transformedBody };
      } catch (error) {
        lastError = error;
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
