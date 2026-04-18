import { HTTP_STATUS, RETRY_CONFIG, DEFAULT_RETRY_CONFIG } from "../config/runtimeConfig.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

/**
 * BaseExecutor - Base class for provider executors
 */
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
      const baseUrl = credentials?.providerSpecificData?.baseUrl || "https://api.openai.com/v1";
      const normalized = baseUrl.replace(/\/$/, "");
      const path = this.provider.includes("responses") ? "/responses" : "/chat/completions";
      return `${normalized}${path}`;
    }
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      const baseUrl = credentials?.providerSpecificData?.baseUrl || "https://api.anthropic.com/v1";
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
        headers["anthropic-version"] = "2023-06-01";
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
    
    // Merge default retry config with provider-specific config
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry };

    for (let urlIndex = 0; urlIndex < fallbackCount; urlIndex++) {
      const url = this.buildUrl(model, stream, urlIndex, credentials);
      const transformedBody = this.transformRequest(model, body, stream, credentials);
      let headers = this.buildHeaders(credentials, stream);

      // Strip OpenAI SDK (X-Stainless-*) metadata headers from passthrough/OpenAI-compatible requests.
      // These headers identify the SDK client and are blocked by some upstream gateways (403).
      // Only strip for OpenAI-compatible endpoints — other providers may legitimately use them.
      const isOpenAICompatible = this.provider?.startsWith?.("openai-compatible-") ||
        url.includes("/v1/chat/completions") || url.includes("/v1/responses");
      if (isOpenAICompatible) {
        const strippedKeys = [];
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase().startsWith("x-stainless-")) {
            delete headers[key];
            strippedKeys.push(key);
          }
        }
        // Normalize User-Agent: SDK-based clients send verbose product strings that some upstreams block.
        // Replace with a clean browser-like UA if it looks SDK-derived.
        const ua = (headers["User-Agent"] || "").toLowerCase();
        if (ua.includes("openai") && (ua.includes("node") || ua.includes("axios") || ua.includes("undici"))) {
          headers["User-Agent"] = "Mozilla/5.0 (compatible; OpenAI Compatible)";
        }
        if (strippedKeys.length > 0) {
          log?.debug?.("HEADERS", `Stripped X-Stainless-* from passthrough request: ${strippedKeys.join(", ")}`);
        }
      }

      if (!retryAttemptsByUrl[urlIndex]) retryAttemptsByUrl[urlIndex] = 0;

      try {
        const response = await proxyAwareFetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(transformedBody),
          signal
        }, proxyOptions);

        // Retry based on status code config
        const maxRetries = retryConfig[response.status] || 0;
        if (maxRetries > 0 && retryAttemptsByUrl[urlIndex] < maxRetries) {
          retryAttemptsByUrl[urlIndex]++;
          log?.debug?.("RETRY", `${response.status} retry ${retryAttemptsByUrl[urlIndex]}/${maxRetries} after ${RETRY_CONFIG.delayMs / 1000}s`);
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
