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
import type {
	ExecutorCredentials,
	ProxyOptions,
	ExecutorLog,
	ExecutorBody,
	ExecutorFetchResult,
	ExecutorResult,
	ExecutorSuccess,
	ExecutorError,
	JsonValue,
} from "../types/executor.js";
import type { ProviderId, ModelId } from "../types/ids.js";
import { createErrorResult } from "../utils/error.js";

// Suppress unused-import warning: RETRY_CONFIG is re-exported by runtimeConfig
// for backward compat and may be consumed by subclasses at runtime.
void RETRY_CONFIG;
// Wave-contract import: available for subclasses; not called in base.
void createErrorResult;
// Locally-typed wrapper: proxyAwareFetch is a .js file with `proxyOptions = null`
// default; TS infers the third param as `null` only. Widen to the actual runtime
// contract so callers can pass ProxyOptions | null without a cast.
const fetchWithProxy = proxyAwareFetch as (
	url: string,
	options: RequestInit,
	proxyOptions?: ProxyOptions | null,
) => Promise<Response>;

// Promise.withResolvers is ES2024; declare it here so tsconfig lib: ES2022 doesn't error.
declare global {
	interface PromiseConstructor {
		withResolvers<T>(): { promise: Promise<T>; resolve: (value: T | PromiseLike<T>) => void; reject: (reason?: DOMException | Error | string) => void };
	}
}

/** A single retry-entry accepted by resolveRetryEntry — numeric shorthand or full shape. */
type RetryEntry =
  | number
  | {
      attempts?: number;
      delayMs?: number;
      backoff?: "exp" | "fixed";
      maxDelayMs?: number;
      jitter?: boolean;
    }
  | null
  | undefined;

interface ExecutorConfig {
	baseUrl?: string;
	baseUrls?: string[];
	headers?: Record<string, string>;
	retry?: Record<number, RetryEntry>;
	timeoutMs?: number;
	noAuth?: boolean;
	rng?: () => number;
}

/**
 * BaseExecutor - Base class for provider executors
 */
export class BaseExecutor {
	protected readonly provider: ProviderId | string;
	protected readonly config: ExecutorConfig;
	protected readonly noAuth: boolean;

	constructor(provider: ProviderId | string, config: ExecutorConfig = {}) {
		this.provider = provider;
		this.config = config;
		this.noAuth = config.noAuth ?? false;
	}

	getProvider(): string {
		return this.provider;
	}

	getBaseUrls(): string[] {
		return (
			this.config.baseUrls ??
			(this.config.baseUrl !== undefined ? [this.config.baseUrl] : [])
		);
	}

	getFallbackCount(): number {
		return this.getBaseUrls().length || 1;
	}

	buildUrl(
		model: ModelId | string,
		stream: boolean,
		urlIndex = 0,
		credentials: ExecutorCredentials | null = null,
	): string {
		void model;
		void stream;
		if (this.provider?.startsWith?.("openai-compatible-")) {
			const baseUrl = credentials?.providerSpecificData?.baseUrl ?? OPENAI_COMPAT_BASE;
			const normalized = baseUrl.replace(/\/$/, "");
			const path = this.provider.includes("responses")
				? "/responses"
				: "/chat/completions";
			return `${normalized}${path}`;
		}
		if (this.provider?.startsWith?.("anthropic-compatible-")) {
			const baseUrl = credentials?.providerSpecificData?.baseUrl ?? ANTHROPIC_COMPAT_BASE;
			const normalized = baseUrl.replace(/\/$/, "");
			return `${normalized}/messages`;
		}
		const baseUrls = this.getBaseUrls();
		return baseUrls[urlIndex] ?? baseUrls[0] ?? this.config.baseUrl ?? "";
	}

	buildHeaders(
		credentials: ExecutorCredentials,
		stream = true,
	): Record<string, string> {
		const headers: Record<string, string> = {
			"Content-Type": "application/json",
			...this.config.headers,
		};

		if (this.provider?.startsWith?.("anthropic-compatible-")) {
			if (credentials.apiKey !== undefined) {
				headers["x-api-key"] = credentials.apiKey;
			} else if (credentials.accessToken !== undefined) {
				headers["Authorization"] = `Bearer ${credentials.accessToken}`;
			}
			if (headers["anthropic-version"] === undefined) {
				headers["anthropic-version"] = ANTHROPIC_API_VERSION;
			}
		} else {
			if (credentials.accessToken !== undefined) {
				headers["Authorization"] = `Bearer ${credentials.accessToken}`;
			} else if (credentials.apiKey !== undefined) {
				headers["Authorization"] = `Bearer ${credentials.apiKey}`;
			}
		}

		if (stream) {
			headers["Accept"] = "text/event-stream";
		}

		return headers;
	}

	// Override in subclass for provider-specific transformations
	transformRequest(
		model: ModelId | string,
		body: ExecutorBody,
		stream: boolean,
		credentials: ExecutorCredentials,
	): ExecutorBody {
		void model;
		void stream;
		void credentials;
		return body;
	}

	shouldRetry(status: number, urlIndex: number): boolean {
		return (
			status === HTTP_STATUS.RATE_LIMITED &&
			urlIndex + 1 < this.getFallbackCount()
		);
	}

	// Override in subclass for provider-specific refresh
	async refreshCredentials(
		credentials: ExecutorCredentials,
		log: ExecutorLog,
		proxyOptions: ProxyOptions | null = null,
	): Promise<Partial<ExecutorCredentials> | null> {
		void credentials;
		void log;
		void proxyOptions;
		return null;
	}

	needsRefresh(credentials: ExecutorCredentials): boolean {
		return shouldRefreshCredentials(this.provider, credentials);
	}

	parseError(
		response: Response,
		bodyText: string,
	): { status: number; message: string } {
		return {
			status: response.status,
			message: bodyText || `HTTP ${response.status}`,
		};
	}

	// Override in subclass for dynamic retry delay (e.g. Retry-After header).
	// Returns: number → use as waitMs; false → veto retry; null → keep base delay.
	computeRetryDelay?(
		response: Response,
		attempt: number,
		baseWait: number,
	): Promise<number | false | null>;

	async execute({
		model,
		body,
		stream,
		credentials,
		signal,
		log,
		proxyOptions = null,
	}: {
		model: ModelId | string;
		body: ExecutorBody;
		stream: boolean;
		credentials: ExecutorCredentials;
		signal?: AbortSignal;
		log?: ExecutorLog;
		proxyOptions?: ProxyOptions | null;
	}): Promise<ExecutorFetchResult> {
		const fallbackCount = this.getFallbackCount();
		let lastError: Error | null = null;
		let lastStatus = 0;
		const retryAttemptsByUrl: Record<number, number> = {};
		// Self-contained retry budget: wall-clock anchor for the elapsed-cap veto
		// inside tryRetry. Independent of connect/request timeouts so a slow but
		// recoverable upstream can't exceed the configured retry budget.
		const retryStart = Date.now();

		// Merge default retry config with provider-specific config
		const retryConfig = { ...DEFAULT_RETRY_CONFIG, ...this.config.retry };

		// Abort-aware sleep used between retries. If the caller's signal aborts
		// during the sleep, reject immediately with an AbortError so execution
		// exits via the existing abort path instead of continuing with retries.
		const sleepWithAbort = (ms: number, sleepSignal?: AbortSignal): Promise<void> => {
			const { promise, resolve, reject } = Promise.withResolvers<void>();
			if (sleepSignal?.aborted) {
				reject(new DOMException("The operation was aborted.", "AbortError"));
				return promise;
			}
			let onAbort: (() => void) | undefined;
			const timer = setTimeout(() => {
				sleepSignal?.removeEventListener?.("abort", onAbort!);
				resolve();
			}, ms);
			if (sleepSignal !== undefined) {
				onAbort = () => {
					clearTimeout(timer);
					reject(
						new DOMException("The operation was aborted.", "AbortError"),
					);
				};
				sleepSignal.addEventListener("abort", onAbort, { once: true });
			}
			return promise;
		};

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
		const tryRetry = async (
			urlIndex: number,
			statusKey: number,
			reason: string,
			response: Response | null = null,
		): Promise<boolean> => {
			const { attempts, delayMs, backoff, maxDelayMs, jitter } =
				resolveRetryEntry((retryConfig as Record<number, RetryEntry>)[statusKey]);
			const urlAttempts = retryAttemptsByUrl[urlIndex] ?? 0;
			if (attempts <= 0 || urlAttempts >= attempts) return false;
			let waitMs = computeBackoffDelay({
				attempt: urlAttempts + 1,
				baseDelayMs: delayMs,
				maxDelayMs,
				backoff,
				jitter,
				// Optional injectable RNG for deterministic tests. Production callsites
				// leave this unset; only test configs supply it.
				rng: this.config?.rng,
			});
			if (response !== null && this.computeRetryDelay !== undefined) {
				const dynamic = await this.computeRetryDelay(
					response,
					urlAttempts + 1,
					waitMs,
				);
				if (dynamic === false) return false; // hook vetoes retry (e.g. Retry-After too long)
				if (dynamic !== null) waitMs = dynamic;
			}
			if (Date.now() - retryStart + waitMs > RETRY_MAX_ELAPSED_MS) {
				log?.debug?.(
					"RETRY",
					`${reason} retry vetoed: elapsed cap exceeded (${Date.now() - retryStart}ms + ${waitMs}ms > ${RETRY_MAX_ELAPSED_MS}ms)`,
				);
				return false;
			}
			retryAttemptsByUrl[urlIndex] = urlAttempts + 1;
			log?.debug?.(
				"RETRY",
				`${reason} retry ${retryAttemptsByUrl[urlIndex] ?? 1}/${attempts} after ${waitMs / 1000}s`,
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

			if (retryAttemptsByUrl[urlIndex] === undefined) retryAttemptsByUrl[urlIndex] = 0;

			// Abort if upstream doesn't return response headers within connection timeout
			const connectCtrl = new AbortController();
			const timeoutMs = this.config?.timeoutMs ?? FETCH_CONNECT_TIMEOUT_MS;
			const connectTimer = setTimeout(
				() => connectCtrl.abort(new Error("fetch connect timeout")),
				timeoutMs,
			);
			const mergedSignal = signal !== undefined
				? AbortSignal.any([signal, connectCtrl.signal])
				: connectCtrl.signal;

			try {
				const bodyStr = JSON.stringify(transformedBody);
				const fetchT0 = Date.now();
				dbg(
					"FETCH",
					`${this.provider.toUpperCase()} → ${url} | body=${bodyStr.length}B | connectTimeout=${timeoutMs}ms`,
				);
				const response = await fetchWithProxy(
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
				const ct = response.headers?.get?.("content-type") ?? "";
				const cl = response.headers?.get?.("content-length") ?? "?";
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
				const err = error instanceof Error ? error : new Error(String(error));
				lastError = err;
				const isConnectTimeout =
					connectCtrl.signal.aborted && err.name === "AbortError";
				dbg(
					"FETCH",
					`${this.provider.toUpperCase()} ✖ ${err.name}: ${err.message}${isConnectTimeout ? " (connect timeout)" : ""}`,
				);
				// Connect timeout is internal — convert to retryable network error, don't propagate AbortError
				if (err.name === "AbortError" && !isConnectTimeout) throw err;

				// Map network/fetch exceptions to 502 retry config
				if (
					await tryRetry(
						urlIndex,
						HTTP_STATUS.BAD_GATEWAY,
						`network "${err.message}"`,
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
				throw err;
			}
		}

		throw (
			lastError ??
			new Error(`All ${fallbackCount} URLs failed with status ${lastStatus}`)
		);
	}
}

export default BaseExecutor;
