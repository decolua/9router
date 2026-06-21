// HTTP status codes
export const HTTP_STATUS = {
	BAD_REQUEST: 400,
	UNAUTHORIZED: 401,
	PAYMENT_REQUIRED: 402,
	FORBIDDEN: 403,
	NOT_FOUND: 404,
	NOT_ACCEPTABLE: 406,
	REQUEST_TIMEOUT: 408,
	RATE_LIMITED: 429,
	SERVER_ERROR: 500,
	BAD_GATEWAY: 502,
	SERVICE_UNAVAILABLE: 503,
	GATEWAY_TIMEOUT: 504,
};

// Re-export error config (backward compat)
export {
	ERROR_TYPES,
	DEFAULT_ERROR_MESSAGES,
	BACKOFF_CONFIG,
	COOLDOWN_MS,
} from "./errorConfig.js";

// Cache TTLs (seconds)
export const CACHE_TTL = {
	userInfo: 300, // 5 minutes
	modelAlias: 3600, // 1 hour
};

// Memory management config
export const MEMORY_CONFIG = {
	sessionTtlMs: 2 * 60 * 60 * 1000,
	sessionCleanupIntervalMs: 30 * 60 * 1000,
	dnsCacheTtlMs: 5 * 60 * 1000,
	proxyDispatchersMaxSize: 20,
};

// Parse a positive integer env override, falling back to a default.
function envMs(name, def) {
	const raw = process.env[name];
	if (raw == null || raw === "") return def;
	const n = parseInt(raw, 10);
	return Number.isFinite(n) && n > 0 ? n : def;
}

// Parse a boolean env override. Accepts "1", "true", "yes", "on" (case-insensitive)
// as truthy; anything else (including empty) is treated as falsy so the default
// wins unless the operator explicitly opts in.
function envBool(name, def) {
	const raw = process.env[name];
	if (raw == null || raw === "") return def;
	return /^(1|true|yes|on)$/i.test(raw);
}

// Inter-chunk stall timeout (once tokens are flowing). Generous headroom so
// slow reasoning models aren't aborted mid-stream. Env: STREAM_STALL_TIMEOUT_MS.
export const STREAM_STALL_TIMEOUT_MS = envMs(
	"STREAM_STALL_TIMEOUT_MS",
	360 * 1000,
);

// Time-to-first-token timeout (prompt prefill). Env: STREAM_FIRST_CHUNK_TIMEOUT_MS.
export const STREAM_FIRST_CHUNK_TIMEOUT_MS = envMs(
	"STREAM_FIRST_CHUNK_TIMEOUT_MS",
	200 * 1000,
);

// Fetch connect timeout: abort if upstream doesn't return response headers within this duration
export const FETCH_CONNECT_TIMEOUT_MS = envMs(
	"FETCH_CONNECT_TIMEOUT_MS",
	60 * 1000,
);

// Default token limits
export const DEFAULT_MAX_TOKENS = 64000;
export const DEFAULT_MIN_TOKENS = 32000;

// Retry config for 429 responses (legacy - kept for backward compatibility)
export const RETRY_CONFIG = {
	maxAttempts: 2,
	delayMs: 2000,
};

// Default retry config by status code: { attempts, delayMs, backoff, maxDelayMs, jitter }
// Backward compat: a numeric entry is treated as `attempts` with the other fields
// defaulting to fixed delay (no jitter). The full shape is normalized by
// `resolveRetryEntry` so callers can mix legacy numbers with the new
// { attempts, delayMs, backoff, maxDelayMs, jitter } shape.
export const DEFAULT_RETRY_CONFIG = {
	// 429 retries are intentionally NOT enabled by default. Providers that want
	// 429 retries (e.g. antigravity) compute a custom delay via their
	// computeRetryDelay hook (Retry-After header / quota-reset parsing) and
	// use that signal directly. Default blind exponential backoff here would
	// mask Retry-After hints and stack with the provider's own rate-limit
	// recovery window — making things worse, not better.
	429: { attempts: 0, delayMs: 0 },
	// Transient upstream errors (502/503/504): exponential backoff with full
	// jitter. Spreads retry traffic across providers and avoids thundering-herd
	// wakeups after a shared upstream blip. Network exceptions are mapped to the
	// 502 entry by BaseExecutor.tryRetry, so they get the same treatment.
	502: { attempts: 3, delayMs: 1000, backoff: "exp", maxDelayMs: 8000, jitter: true },
	503: { attempts: 3, delayMs: 1000, backoff: "exp", maxDelayMs: 8000, jitter: true },
	504: { attempts: 2, delayMs: 1000, backoff: "exp", maxDelayMs: 4000, jitter: true },
};

// Normalize a retry entry to { attempts, delayMs, backoff, maxDelayMs, jitter }.
// Accepts:
//   - null/undefined → no retries (back-compat: zero attempts, fixed delay)
//   - number         → treated as `attempts` (back-compat with legacy shape)
//   - object         → forward-compatible shape; missing fields get safe defaults
export function resolveRetryEntry(entry) {
	if (entry == null) {
		return {
			attempts: 0,
			delayMs: RETRY_CONFIG.delayMs,
			backoff: "fixed",
			maxDelayMs: RETRY_CONFIG.delayMs,
			jitter: false,
		};
	}
	if (typeof entry === "number") {
		return {
			attempts: entry,
			delayMs: RETRY_CONFIG.delayMs,
			backoff: "fixed",
			maxDelayMs: RETRY_CONFIG.delayMs,
			jitter: false,
		};
	}
	const attempts = entry.attempts || 0;
	const delayMs = entry.delayMs != null ? entry.delayMs : RETRY_CONFIG.delayMs;
	const backoff = entry.backoff === "exp" ? "exp" : "fixed";
	// Default maxDelayMs to delayMs so non-jittered fixed entries stay bounded
	// by their base delay. For exp entries, callers should set maxDelayMs
	// explicitly; otherwise the delay scales unbounded until the env cap kicks in.
	const maxDelayMs = entry.maxDelayMs != null ? entry.maxDelayMs : delayMs;
	const jitter = entry.jitter === true;
	return { attempts, delayMs, backoff, maxDelayMs, jitter };
}

/**
 * Pure backoff/jitter computation. Injected `rng` makes it deterministic in tests.
 *
 * - `backoff: "fixed"` → cap is always `baseDelayMs`.
 * - `backoff: "exp"`   → cap is `baseDelayMs * 2^(attempt-1)`, clamped to `maxDelayMs`.
 * - `jitter: false`    → returns the unscaled cap (deterministic per attempt).
 * - `jitter: true`     → returns `floor(rng() * cap)` (full jitter; AWS-style).
 *
 * Defensive against bad inputs (negative numbers, NaN, huge attempt counts):
 * attempt is clamped to >= 1; base/max are coerced and max is floored at base.
 */
export function computeBackoffDelay({
	attempt,
	baseDelayMs,
	maxDelayMs,
	backoff = "fixed",
	jitter = false,
	rng = Math.random,
}) {
	const safeAttempt = Math.max(1, attempt | 0);
	const safeBase = Math.max(0, Number(baseDelayMs) || 0);
	const safeMax = Math.max(safeBase, Number(maxDelayMs) || 0);
	let cap;
	if (backoff === "exp") {
		// Math.pow overflow guard: cap at safeMax for very large attempt counts.
		const exp = safeBase === 0 ? 0 : safeBase * Math.pow(2, safeAttempt - 1);
		cap = Number.isFinite(exp) ? Math.min(exp, safeMax) : safeMax;
	} else {
		cap = safeBase;
	}
	if (!jitter) return cap;
	const sample = Number(rng());
	if (!Number.isFinite(sample) || sample <= 0) return 0;
	// rng() returns a value in [0, 1]; floor() yields an integer ms value in [0, cap].
	return Math.min(cap, Math.floor(sample * cap));
}

// Self-contained retry budget. Bounds cumulative wait across all retry attempts
// so a single flaky upstream can't pin a request thread indefinitely. This is
// independent of any connect/request timeout — it's the total wall-clock budget
// the retry loop is allowed to consume before bailing out. Env: RETRY_MAX_ELAPSED_MS.
export const RETRY_MAX_ELAPSED_MS = envMs(
	"RETRY_MAX_ELAPSED_MS",
	30 * 1000,
);

// Requests containing these texts will bypass provider
export const SKIP_PATTERNS = [
	"Please write a 5-10 word title for the following conversation:",
];

// Outbound payload validation gate (chatCore runs it before executor.execute).
// Strict by default; set VALIDATE_OUTBOUND=false to bypass in an emergency.
// Stripping of internal keys is independent and always runs.
export const VALIDATE_OUTBOUND = envBool("VALIDATE_OUTBOUND", true);
