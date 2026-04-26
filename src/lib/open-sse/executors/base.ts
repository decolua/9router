import { HTTP_STATUS, DEFAULT_RETRY_CONFIG, type RetryPolicy } from "../config/runtimeConfig";
import { proxyAwareFetch } from "../utils/proxyFetch";

/**
 * BaseExecutor - Base class for provider executors
 */
export class BaseExecutor {
  provider: string;
  config: any;
  noAuth: boolean;

  constructor(provider: string, config: any) {
    this.provider = provider;
    this.config = config;
    this.noAuth = config?.noAuth || false;
  }

  getProvider() {
    return this.provider;
  }

  getBaseUrls(): string[] {
    return this.config.baseUrls || (this.config.baseUrl ? [this.config.baseUrl] : []);
  }

  getFallbackCount() {
    return this.getBaseUrls().length || 1;
  }

  buildUrl(model: string, stream: boolean, urlIndex: number = 0, credentials: any = null) {
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

  buildHeaders(credentials: any, stream = true) {
    const headers: Record<string, string> = {
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
  transformRequest(model: string, body: any, stream: boolean, credentials: any) {
    return body;
  }

  shouldRetry(status: number, urlIndex: number) {
    return status === HTTP_STATUS.RATE_LIMITED && urlIndex + 1 < this.getFallbackCount();
  }

  // Override in subclass for provider-specific refresh
  async refreshCredentials(credentials: any, log?: any): Promise<any> {
    return null;
  }

  needsRefresh(credentials: any) {
    if (!credentials.expiresAt) return false;
    const expiresAtMs = new Date(credentials.expiresAt).getTime();
    return expiresAtMs - Date.now() < 5 * 60 * 1000;
  }

  parseError(response: Response, bodyText: string) {
    return { status: response.status, message: bodyText || `HTTP ${response.status}` };
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null }: any): Promise<any> {
    const fallbackCount = this.getFallbackCount();
    let lastError: any = null;
    let lastStatus = 0;
    const retryAttemptsByUrl: Record<number, Record<string, number>> = {};

    // Merge default retry config with provider-specific config
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry } as Record<string, RetryPolicy>;

    const getPolicy = (status: number): RetryPolicy => {
      const policy = retryConfig[String(status)] || retryConfig[status as unknown as keyof typeof retryConfig];
      if (policy && typeof policy === "object") {
        return policy as RetryPolicy;
      }
      return { attempts: 0, delayMs: 0 };
    };

    const getNetworkPolicy = (): RetryPolicy => {
      const policy = retryConfig.network;
      if (policy && typeof policy === "object") {
        return policy as RetryPolicy;
      }
      return { attempts: 0, delayMs: 0 };
    };

    for (let urlIndex = 0; urlIndex < fallbackCount; urlIndex++) {
      const url = this.buildUrl(model, stream, urlIndex, credentials);
      const transformedBody = this.transformRequest(model, body, stream, credentials);
      const headers = this.buildHeaders(credentials, stream);

      if (!retryAttemptsByUrl[urlIndex]) retryAttemptsByUrl[urlIndex] = {};

      try {
        const response = await proxyAwareFetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify(transformedBody),
          signal
        }, proxyOptions);

        // Retry based on status code config
        const policy = getPolicy(response.status);
        const statusRetryKey = `status:${response.status}`;
        const statusAttempts = retryAttemptsByUrl[urlIndex][statusRetryKey] || 0;
        if (policy.attempts > 0 && statusAttempts < policy.attempts) {
          retryAttemptsByUrl[urlIndex][statusRetryKey] = statusAttempts + 1;
          log?.debug?.("RETRY", `${response.status} retry ${retryAttemptsByUrl[urlIndex][statusRetryKey]}/${policy.attempts} after ${policy.delayMs / 1000}s`);
          await new Promise(resolve => setTimeout(resolve, policy.delayMs));
          urlIndex--;
          continue;
        }

        if (this.shouldRetry(response.status, urlIndex)) {
          log?.debug?.("RETRY", `${response.status} on ${url}, trying fallback ${urlIndex + 1}`);
          lastStatus = response.status;
          continue;
        }

        return { response, url, headers, transformedBody };
      } catch (error: any) {
        lastError = error;

        const networkPolicy = getNetworkPolicy();
        const networkRetryKey = "network";
        const networkAttempts = retryAttemptsByUrl[urlIndex][networkRetryKey] || 0;
        if (networkPolicy.attempts > 0 && networkAttempts < networkPolicy.attempts) {
          retryAttemptsByUrl[urlIndex][networkRetryKey] = networkAttempts + 1;
          log?.debug?.("RETRY", `Network error retry ${retryAttemptsByUrl[urlIndex][networkRetryKey]}/${networkPolicy.attempts} after ${networkPolicy.delayMs / 1000}s on ${url}`);
          await new Promise(resolve => setTimeout(resolve, networkPolicy.delayMs));
          urlIndex--;
          continue;
        }

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
