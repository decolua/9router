import {
  HTTP_STATUS,
  RETRY_CONFIG,
  DEFAULT_RETRY_CONFIG,
  resolveRetryEntry,
  FETCH_CONNECT_TIMEOUT_MS,
} from "../config/runtimeConfig.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { dbg } from "../utils/debugLog.js";

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

  isOverloadedError(status, message) {
    const msg = (message || "").toLowerCase();
    const overloadedKeywords = [
      "overloaded",
      "try again later",
      "capacity",
      "high traffic",
      "temporarily unavailable",
      "server is busy",
      "overload",
    ];
    if (status === 529 || status === 503) return true;
    if (
      status === 429 &&
      overloadedKeywords.some((keyword) => msg.includes(keyword))
    ) {
      return true;
    }
    return false;
  }

  getBaseUrls() {
    return (
      this.config.baseUrls || (this.config.baseUrl ? [this.config.baseUrl] : [])
    );
  }

  getFallbackCount() {
    return this.getBaseUrls().length || 1;
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    if (this.provider?.startsWith?.("openai-compatible-")) {
      const baseUrl =
        credentials?.providerSpecificData?.baseUrl ||
        "https://api.openai.com/v1";
      const normalized = baseUrl.replace(/\/$/, "");
      const path = this.provider.includes("responses")
        ? "/responses"
        : "/chat/completions";
      return `${normalized}${path}`;
    }
    if (this.provider?.startsWith?.("anthropic-compatible-")) {
      const baseUrl =
        credentials?.providerSpecificData?.baseUrl ||
        "https://api.anthropic.com/v1";
      const normalized = baseUrl.replace(/\/$/, "");
      return `${normalized}/messages`;
    }
    const baseUrls = this.getBaseUrls();
    return baseUrls[urlIndex] || baseUrls[0] || this.config.baseUrl;
  }

  buildHeaders(credentials, stream = true) {
    const headers = {
      "Content-Type": "application/json",
      ...this.config.headers,
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
    return (
      status === HTTP_STATUS.RATE_LIMITED &&
      urlIndex + 1 < this.getFallbackCount()
    );
  }

  // Override in subclass for provider-specific refresh
  async refreshCredentials(credentials, log, proxyOptions = null) {
    return null;
  }

  needsRefresh(credentials) {
    if (!credentials.expiresAt) return false;
    const expiresAtMs = new Date(credentials.expiresAt).getTime();
    return expiresAtMs - Date.now() < 5 * 60 * 1000;
  }

  parseError(response, bodyText) {
    return {
      status: response.status,
      message: bodyText || `HTTP ${response.status}`,
    };
  }

  async execute({
    model,
    body,
    stream,
    credentials,
    signal,
    log,
    proxyOptions = null,
  }) {
    const fallbackCount = this.getFallbackCount();
    let lastError = null;
    let lastStatus = 0;
    const retryAttemptsByUrl = {};

    // Merge default retry config with provider-specific config
    const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry };

    // Schedule retry via retryConfig[statusKey]. Returns true when caller should `urlIndex--; continue`
    const tryRetry = async (urlIndex, statusKey, reason) => {
      const { attempts, delayMs } = resolveRetryEntry(retryConfig[statusKey]);
      if (attempts <= 0 || retryAttemptsByUrl[urlIndex] >= attempts)
        return false;
      retryAttemptsByUrl[urlIndex]++;
      log?.debug?.(
        "RETRY",
        `${reason} retry ${retryAttemptsByUrl[urlIndex]}/${attempts} after ${delayMs / 1000}s`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return true;
    };

    // Calculate connection timeout (custom from credentials or universal default of 15s)
    const providerSpecific = credentials?.providerSpecificData || {};
    let timeoutMs = providerSpecific.connectionTimeoutMs;
    if (typeof timeoutMs !== "number" || isNaN(timeoutMs) || timeoutMs <= 0) {
      timeoutMs = 15000; // Universal default of 15 seconds
    }

    for (let urlIndex = 0; urlIndex < fallbackCount; urlIndex++) {
      const url = this.buildUrl(model, stream, urlIndex, credentials);
      const transformedBody = this.transformRequest(
        model,
        body,
        stream,
        credentials,
      );
      const headers = this.buildHeaders(credentials, stream);

      if (!retryAttemptsByUrl[urlIndex]) retryAttemptsByUrl[urlIndex] = 0;

      // Abort if upstream doesn't return response headers within FETCH_CONNECT_TIMEOUT_MS,
      // while still preserving the branch-specific per-provider connection timeout.
      const fetchController = new AbortController();
      const connectCtrl = new AbortController();
      const connectTimer = setTimeout(
        () => connectCtrl.abort(new Error("fetch connect timeout")),
        FETCH_CONNECT_TIMEOUT_MS,
      );
      const mergedSignal = AbortSignal.any([
        fetchController.signal,
        connectCtrl.signal,
      ]);

      // Forward client abort to fetch signal
      let clientSignalListener = null;
      if (signal) {
        if (signal.aborted) {
          fetchController.abort(signal.reason);
        } else {
          clientSignalListener = () => {
            fetchController.abort(signal.reason);
          };
          signal.addEventListener("abort", clientSignalListener);
        }
      }

      // Start branch-specific connection timeout timer.
      let timedOut = false;
      const timeoutTimer = setTimeout(() => {
        timedOut = true;
        const err = new DOMException("Connection timed out", "TimeoutError");
        fetchController.abort(err);
      }, timeoutMs);

      try {
        const bodyStr = JSON.stringify(transformedBody);
        const fetchT0 = Date.now();
        dbg(
          "FETCH",
          `${this.provider.toUpperCase()} → ${url} | body=${bodyStr.length}B | connectTimeout=${FETCH_CONNECT_TIMEOUT_MS}ms | providerTimeout=${timeoutMs}ms`,
        );
        const response = await proxyAwareFetch(
          url,
          {
            method: "POST",
            headers,
            body: bodyStr,
            signal: mergedSignal,
          },
          proxyOptions,
        );

        clearTimeout(connectTimer);
        clearTimeout(timeoutTimer);

        const ct = response.headers?.get?.("content-type") || "";
        const cl = response.headers?.get?.("content-length") || "?";
        const fetchTiming = response.__timing || null;
        const timingBreakdown = fetchTiming
          ? {
              mode: fetchTiming.mode,
              dnsMs:
                fetchTiming.dnsStartAt && fetchTiming.dnsResolvedAt
                  ? fetchTiming.dnsResolvedAt - fetchTiming.dnsStartAt
                  : undefined,
              dispatcherMs:
                fetchTiming.proxyStartAt && fetchTiming.dispatcherReadyAt
                  ? fetchTiming.dispatcherReadyAt - fetchTiming.proxyStartAt
                  : undefined,
              relayMs:
                fetchTiming.relayStartAt && fetchTiming.headersAt
                  ? fetchTiming.headersAt - fetchTiming.relayStartAt
                  : undefined,
              headersMs:
                fetchTiming.startedAt && fetchTiming.headersAt
                  ? fetchTiming.headersAt - fetchTiming.startedAt
                  : undefined,
            }
          : null;
        dbg(
          "FETCH",
          `${this.provider.toUpperCase()} ← ${response.status} | ttft=${Date.now() - fetchT0}ms | ct=${ct} | cl=${cl}${timingBreakdown ? ` | net=${JSON.stringify(timingBreakdown)}` : ""}`,
        );
        if (timingBreakdown) {
          log?.info?.(
            "FETCH",
            `${this.provider.toUpperCase()} | mode=${timingBreakdown.mode} | headers=${timingBreakdown.headersMs ?? "?"}ms | dns=${timingBreakdown.dnsMs ?? "-"}ms | dispatcher=${timingBreakdown.dispatcherMs ?? "-"}ms | relay=${timingBreakdown.relayMs ?? "-"}ms`,
          );
        }

        // Connection successful! Let the stream run indefinitely after headers arrive.

        if (clientSignalListener && signal) {
          signal.removeEventListener("abort", clientSignalListener);
        }

        if (!response.ok) {
          let bodyText = "";
          try {
            const cloned = response.clone();
            bodyText = await cloned.text();
          } catch (e) {}

          if (this.isOverloadedError(response.status, bodyText)) {
            const attempts = 3;
            const delayMs = 2000;
            if (retryAttemptsByUrl[urlIndex] < attempts) {
              retryAttemptsByUrl[urlIndex]++;
              log?.debug?.(
                "RETRY",
                `Overloaded status ${response.status} retry ${retryAttemptsByUrl[urlIndex]}/${attempts} after ${delayMs / 1000}s. Error details: ${bodyText.slice(0, 100)}`,
              );
              await new Promise((resolve) => setTimeout(resolve, delayMs));
              urlIndex--;
              continue;
            }
          }
        }

        retryAttemptsByUrl[urlIndex] = 0;

        if (
          await tryRetry(urlIndex, response.status, `status ${response.status}`)
        ) {
          urlIndex--;
          continue;
        }

        if (this.shouldRetry(response.status, urlIndex)) {
          log?.debug?.(
            "RETRY",
            `${response.status} on ${url}, trying fallback ${urlIndex + 1}`,
          );
          lastStatus = response.status;
          continue;
        }

        return { response, url, headers, transformedBody };
      } catch (error) {
        clearTimeout(connectTimer);
        clearTimeout(timeoutTimer);
        if (clientSignalListener && signal) {
          signal.removeEventListener("abort", clientSignalListener);
        }

        lastError = error;
        const isConnectTimeout =
          connectCtrl.signal.aborted && error.name === "AbortError";
        dbg(
          "FETCH",
          `${this.provider.toUpperCase()} ✖ ${error.name}: ${error.message}${isConnectTimeout ? " (connect timeout)" : ""}`,
        );

        // Preserve branch-specific provider timeout behavior.
        const isTimeout =
          timedOut ||
          error.name === "TimeoutError" ||
          error.status === 504 ||
          isConnectTimeout;
        if (isTimeout) {
          const timeoutError = new Error(
            `Connection to provider ${this.provider} timed out after ${timedOut ? timeoutMs : FETCH_CONNECT_TIMEOUT_MS}ms`,
          );
          timeoutError.name = "TimeoutError";
          timeoutError.status = 504;
          throw timeoutError;
        }

        if (error.name === "AbortError") throw error;

        // Map network/fetch exceptions to 502 retry config
        if (
          await tryRetry(
            urlIndex,
            HTTP_STATUS.BAD_GATEWAY,
            `network "${error.message}"`,
          )
        ) {
          urlIndex--;
          continue;
        }

        if (urlIndex + 1 < fallbackCount) {
          log?.debug?.(
            "RETRY",
            `Error on ${url}, trying fallback ${urlIndex + 1}`,
          );
          continue;
        }
        throw error;
      }
    }

    throw (
      lastError ||
      new Error(`All ${fallbackCount} URLs failed with status ${lastStatus}`)
    );
  }
}

export default BaseExecutor;
