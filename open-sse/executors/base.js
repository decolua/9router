import { HTTP_STATUS, RETRY_CONFIG, DEFAULT_RETRY_CONFIG } from "../config/runtimeConfig.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";

/**
 * BaseExecutor - Base class for provider executors
 */
export class BaseExecutor {
  constructor(provider, config) {
    this.provider = provider;
    this.config = config;
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

  /**
   * Build headers for passthrough mode: forward client's original headers,
   * only swapping auth and ensuring required beta flags.
   */
  buildPassthroughHeaders(clientHeaders, credentials, stream) {
    const headers = { ...clientHeaders };

    // Remove hop-by-hop and transport headers that should not be forwarded
    for (const h of ["host", "content-length", "connection", "transfer-encoding", "accept-encoding"]) {
      delete headers[h];
    }

    // Swap auth: remove client auth (authenticated to 9router), add upstream auth
    delete headers["authorization"];
    delete headers["x-api-key"];

    if (credentials.apiKey) {
      headers["x-api-key"] = credentials.apiKey;
    } else if (credentials.accessToken) {
      headers["authorization"] = `Bearer ${credentials.accessToken}`;
    }

    // Ensure oauth beta flag when using OAuth access token
    if (credentials.accessToken) {
      const existing = headers["anthropic-beta"] || "";
      if (!existing.includes("oauth-2025-04-20")) {
        headers["anthropic-beta"] = existing
          ? `${existing},oauth-2025-04-20`
          : "oauth-2025-04-20";
      }
    }

    if (stream) {
      headers["accept"] = "text/event-stream";
    }

    return headers;
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null, passthrough = false, clientHeaders = null }) {
    const fallbackCount = this.getFallbackCount();
    let lastError = null;
    let lastStatus = 0;
    const retryAttemptsByUrl = {};
    
    // Merge default retry config with provider-specific config
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry };

    for (let urlIndex = 0; urlIndex < fallbackCount; urlIndex++) {
      const url = this.buildUrl(model, stream, urlIndex, credentials);
      const transformedBody = this.transformRequest(model, body, stream, credentials);
      const headers = (passthrough && clientHeaders)
        ? this.buildPassthroughHeaders(clientHeaders, credentials, stream)
        : this.buildHeaders(credentials, stream);

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
