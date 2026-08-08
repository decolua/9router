import { HTTP_STATUS, RETRY_CONFIG, DEFAULT_RETRY_CONFIG, resolveRetryEntry, FETCH_CONNECT_TIMEOUT_MS } from "../config/runtimeConfig.js";
import { shouldRefreshCredentials } from "../services/oauthCredentialManager.js";
import { matchSkipRule } from "../services/accountFallback.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { dbg } from "../utils/debugLog.js";
import { ANTHROPIC_API_VERSION, OPENAI_COMPAT_BASE, ANTHROPIC_COMPAT_BASE } from "../providers/shared.js";
import { resolveOpenAICompatibleApiType } from "../services/provider.js";

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
    return { status: response.status, message: bodyText || `HTTP ${response.status}` };
  }

  async execute({ model, body, stream, credentials, signal, log, proxyOptions = null, requestPolicy = null }) {
    const fallbackCount = this.getFallbackCount();
    let lastError = null;
    let lastStatus = 0;
    const retryAttemptsByUrl = {};

    // Merge default retry config with provider-specific config (base ceiling per status).
    // NOTE: never mutate this.config — executors are cached singletons shared across
    // concurrent requests. All per-request policy lives in local vars derived from requestPolicy.
    const baseRetry = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry };
    const maxTransportAttempts = requestPolicy?.maxTransportAttempts;
    const skipRules = requestPolicy?.skipRules || null;
    // Whether any skip-rule for THIS provider matches on response body text
    // (match.contains). Only then do we pay to read the error body below.
    const hasContainsRule = Array.isArray(skipRules) &&
      skipRules.some(r => r && r.provider === this.provider && r.match?.contains != null);
    // Header/connect timeout: per-request override → provider config → global default.
    const headerTimeoutMs = requestPolicy?.headerTimeoutMs || this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS;

    // Resolve how many in-place TRANSPORT retries are allowed for a failure.
    //   rule skip       → 0 (abandon this account now)
    //   rule retry      → 0 HERE: an account-retry rule is served by the
    //                     account-selection layer, which re-calls the SAME account
    //                     retryAttempts times. Spending transport attempts on it too
    //                     would multiply the two budgets and, worse, tie the user's
    //                     account-retry count to maxTransportAttempts -- which is what
    //                     this rule kind previously (and wrongly) did.
    //   no rule         → min(baseRetry[status].attempts, maxTransportAttempts - 1)
    //   connect_timeout → 0 unless an explicit retry rule matches it
    // Transport retry (network/URL-fallback) keeps maxTransportAttempts; account
    // retry keeps rule.retryAttempts. The two budgets never borrow from each other.
    const resolveAttempts = ({ statusKey, errorKind, text }) => {
      const base = resolveRetryEntry(baseRetry[statusKey]);
      const rule = skipRules
        ? matchSkipRule(this.provider, { status: statusKey, errorKind, text }, skipRules)
        : null;
      const cap = maxTransportAttempts != null ? Math.max(0, maxTransportAttempts - 1) : null;

      if (rule?.action === "skip") return { attempts: 0, delayMs: base.delayMs };
      if (rule?.action === "retry") return { attempts: 0, delayMs: base.delayMs };
      // No explicit rule
      if (errorKind === "connect_timeout") return { attempts: 0, delayMs: base.delayMs };
      const attempts = cap != null ? Math.min(base.attempts, cap) : base.attempts;
      return { attempts, delayMs: base.delayMs };
    };

    // A matched skip-rule means: abandon this account entirely — do NOT cycle the
    // remaining transport fallback URLs on the same account (which would keep hitting
    // a stalled/at-capacity upstream). The account-selection layer picks the next
    // account/model.
    // A matched RETRY rule returns here too: the account layer is about to re-call
    // this same account, so exhausting the remaining base URLs first would delay it
    // and change which URL the retry lands on. Returns the matched rule or null.
    const matchedSkip = ({ statusKey, errorKind, text }) => {
      if (!skipRules) return null;
      const rule = matchSkipRule(this.provider, { status: statusKey, errorKind, text }, skipRules);
      return (rule?.action === "skip" || rule?.action === "retry") ? rule : null;
    };

    // Schedule retry. Returns true when caller should `urlIndex--; continue`.
    // response (optional) lets a subclass hook compute a dynamic delay (e.g. antigravity Retry-After).
    const tryRetry = async (urlIndex, statusKey, reason, response = null, errorKind = null, text = null) => {
      const { attempts, delayMs } = resolveAttempts({ statusKey, errorKind, text });
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

      // Abort if upstream doesn't return response headers within the connect/header timeout.
      // Use a closure flag to detect OUR timeout: undici rejects with the exact reason object
      // we pass to abort(), so error.name stays "Error" (NOT "AbortError") on Node/undici —
      // the old `error.name === "AbortError"` check never fired. The flag is authoritative.
      const connectCtrl = new AbortController();
      let connectTimedOut = false;
      const connectTimer = setTimeout(() => {
        connectTimedOut = true;
        connectCtrl.abort(new Error("fetch connect timeout"));
      }, headerTimeoutMs);
      const mergedSignal = signal ? AbortSignal.any([signal, connectCtrl.signal]) : connectCtrl.signal;

      try {
        const bodyStr = JSON.stringify(transformedBody);
        const fetchT0 = Date.now();
        dbg("FETCH", `${this.provider.toUpperCase()} → ${url} | body=${bodyStr.length}B | connectTimeout=${headerTimeoutMs}ms`);
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

        // Read the error body ONLY when a contains-rule for this provider could fire
        // (and the status is an error). Clone so the original body stays intact for the
        // caller/translator. Without this, match.contains never matches at the transport
        // tier and a status-based retry could run against the user's intent.
        let errorText = null;
        if (hasContainsRule && response.status >= 400) {
          try { errorText = await response.clone().text(); } catch { /* body unreadable → skip contains */ }
        }

        if (await tryRetry(urlIndex, response.status, `status ${response.status}`, response, `http_${response.status}`, errorText)) { urlIndex--; continue; }

        // A skip-rule matched this HTTP failure → abandon this account now; do NOT
        // fall through to shouldRetry()/other base URLs on the same account.
        if (matchedSkip({ statusKey: response.status, errorKind: `http_${response.status}`, text: errorText })) {
          return { response, url, headers, transformedBody };
        }

        if (this.shouldRetry(response.status, urlIndex)) {
          log?.debug?.("RETRY", `${response.status} on ${url}, trying fallback ${urlIndex + 1}`);
          lastStatus = response.status;
          continue;
        }

        return { response, url, headers, transformedBody };
      } catch (error) {
        clearTimeout(connectTimer);
        lastError = error;
        const isConnectTimeout = connectTimedOut;
        // Classify: our header-timeout vs a caller-initiated abort vs a generic network error.
        const errorKind = isConnectTimeout ? "connect_timeout" : "network";
        dbg("FETCH", `${this.provider.toUpperCase()} ✖ ${error.name}: ${error.message}${isConnectTimeout ? " (connect timeout)" : ""}`);
        // A caller-initiated abort (signal aborted but NOT our connect timer) must propagate.
        if (!isConnectTimeout && signal?.aborted) {
          error.errorKind = "aborted";
          throw error;
        }

        // connect_timeout / network → retryable per resolveAttempts (default: connect_timeout=0 retries)
        if (await tryRetry(urlIndex, HTTP_STATUS.BAD_GATEWAY, `${errorKind} "${error.message}"`, null, errorKind, error.message)) { urlIndex--; continue; }

        // A skip-rule matched this exception → abandon this account now; do NOT cycle
        // the remaining base URLs on the same account. Let the account layer fall back.
        if (matchedSkip({ statusKey: HTTP_STATUS.BAD_GATEWAY, errorKind, text: error.message })) {
          error.errorKind = errorKind;
          throw error;
        }

        if (urlIndex + 1 < fallbackCount) {
          log?.debug?.("RETRY", `Error on ${url}, trying fallback ${urlIndex + 1}`);
          continue;
        }
        error.errorKind = errorKind;
        throw error;
      }
    }

    throw lastError || new Error(`All ${fallbackCount} URLs failed with status ${lastStatus}`);
  }
}

export default BaseExecutor;
