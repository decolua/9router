import {
	HTTP_STATUS,
	RETRY_CONFIG,
	DEFAULT_RETRY_CONFIG,
	resolveRetryEntry,
	computeBackoffDelay,
	RETRY_MAX_ELAPSED_MS,
	FETCH_CONNECT_TIMEOUT_MS,
} from "../config/runtimeConfig.js";
import { shouldRefreshCredentials } from "../services/oauthCredentialManager.js";
import { proxyAwareFetch } from "../utils/proxyFetch.js";
import { dbg } from "../utils/debugLog.js";
import {
	ANTHROPIC_API_VERSION,
	OPENAI_COMPAT_BASE,
	ANTHROPIC_COMPAT_BASE,
} from "../providers/shared.js";

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
				credentials?.providerSpecificData?.baseUrl || OPENAI_COMPAT_BASE;
			const normalized = baseUrl.replace(/\/$/, "");
			const path = this.provider.includes("responses")
				? "/responses"
				: "/chat/completions";
			return `${normalized}${path}`;
		}
		if (this.provider?.startsWith?.("anthropic-compatible-")) {
			const baseUrl =
				credentials?.providerSpecificData?.baseUrl || ANTHROPIC_COMPAT_BASE;
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
		return shouldRefreshCredentials(this.provider, credentials);
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
		// Self-contained retry budget: wall-clock anchor for the elapsed-cap veto
		// inside tryRetry. Independent of connect/request timeouts so a slow but
		// recoverable upstream can't exceed the configured retry budget.
		const retryStart = Date.now();

		// Merge default retry config with provider-specific config
		const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry };

		// Abort-aware sleep used between retries. If the caller's signal aborts
		// during the sleep, reject immediately with an AbortError so execution
		// exits via the existing abort path instead of continuing with retries.
		const sleepWithAbort = (ms, sleepSignal) =>
			new Promise((resolve, reject) => {
				if (sleepSignal?.aborted) {
					reject(new DOMException("The operation was aborted.", "AbortError"));
					return;
				}
				let onAbort;
				const timer = setTimeout(() => {
					sleepSignal?.removeEventListener?.("abort", onAbort);
					resolve();
				}, ms);
				if (sleepSignal) {
					onAbort = () => {
						clearTimeout(timer);
						reject(
							new DOMException("The operation was aborted.", "AbortError"),
						);
					};
					sleepSignal.addEventListener("abort", onAbort, { once: true });
				}
			});

		// Schedule retry via retryConfig[statusKey]. Returns true when caller should `urlIndex--; continue`
		// response (optional) lets a subclass hook compute a dynamic delay (e.g. antigravity Retry-After).
		//
		// Precedence for the wait value:
		//   1. computeBackoffDelay(...) — base cap honoring `backoff` + `jitter` shape.
		//   2. computeRetryDelay(response, attempt, baseWait) — subclass hook wins:
		//        - returns a number → use it (overrides base).
		//        - returns false    → veto the retry entirely (e.g. Retry-After too long).
		//        - returns null     → fall through, keep the computed base.
		//   3. Elapsed-cap veto — refuse the retry if Date.now() - retryStart + waitMs
		//      would exceed RETRY_MAX_ELAPSED_MS. Prevents a single flaky upstream
		//      from pinning the request thread. NOT derived from connect/request
		//      timeouts; it's an independent self-contained retry budget.
		const tryRetry = async (urlIndex, statusKey, reason, response = null) => {
			const { attempts, delayMs, backoff, maxDelayMs, jitter } =
				resolveRetryEntry(retryConfig[statusKey]);
			if (attempts <= 0 || retryAttemptsByUrl[urlIndex] >= attempts)
				return false;
			let waitMs = computeBackoffDelay({
				attempt: retryAttemptsByUrl[urlIndex] + 1,
				baseDelayMs: delayMs,
				maxDelayMs,
				backoff,
				jitter,
				// Optional injectable RNG for deterministic tests. Production callsites
				// leave this unset; only test configs supply it.
				rng: this.config?.rng,
			});
			if (response && this.computeRetryDelay) {
				const dynamic = await this.computeRetryDelay(
					response,
					retryAttemptsByUrl[urlIndex] + 1,
					waitMs,
				);
				if (dynamic === false) return false; // hook vetoes retry (e.g. Retry-After too long)
				if (dynamic != null) waitMs = dynamic;
			}
			if (Date.now() - retryStart + waitMs > RETRY_MAX_ELAPSED_MS) {
				log?.debug?.(
					"RETRY",
					`${reason} retry vetoed: elapsed cap exceeded (${Date.now() - retryStart}ms + ${waitMs}ms > ${RETRY_MAX_ELAPSED_MS}ms)`,
				);
				return false;
			}
			retryAttemptsByUrl[urlIndex]++;
			log?.debug?.(
				"RETRY",
				`${reason} retry ${retryAttemptsByUrl[urlIndex]}/${attempts} after ${waitMs / 1000}s`,
			);
			await sleepWithAbort(waitMs, signal);
			return true;
		};

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

			// Abort if upstream doesn't return response headers within connection timeout
			const connectCtrl = new AbortController();
			const timeoutMs = this.config?.timeoutMs || FETCH_CONNECT_TIMEOUT_MS;
			const connectTimer = setTimeout(
				() => connectCtrl.abort(new Error("fetch connect timeout")),
				timeoutMs,
			);
			const mergedSignal = signal
				? AbortSignal.any([signal, connectCtrl.signal])
				: connectCtrl.signal;

			try {
				const bodyStr = JSON.stringify(transformedBody);
				const fetchT0 = Date.now();
				dbg(
					"FETCH",
					`${this.provider.toUpperCase()} → ${url} | body=${bodyStr.length}B | connectTimeout=${timeoutMs}ms`,
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
				const ct = response.headers?.get?.("content-type") || "";
				const cl = response.headers?.get?.("content-length") || "?";
				dbg(
					"FETCH",
					`${this.provider.toUpperCase()} ← ${response.status} | ttft=${Date.now() - fetchT0}ms | ct=${ct} | cl=${cl}`,
				);

				if (
					await tryRetry(
						urlIndex,
						response.status,
						`status ${response.status}`,
						response,
					)
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
				lastError = error;
				const isConnectTimeout =
					connectCtrl.signal.aborted && error.name === "AbortError";
				dbg(
					"FETCH",
					`${this.provider.toUpperCase()} ✖ ${error.name}: ${error.message}${isConnectTimeout ? " (connect timeout)" : ""}`,
				);
				// Connect timeout is internal — convert to retryable network error, don't propagate AbortError
				if (error.name === "AbortError" && !isConnectTimeout) throw error;

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
