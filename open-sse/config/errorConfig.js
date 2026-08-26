// OpenAI-compatible error types mapping (client-facing)
export const ERROR_TYPES = {
  400: { type: "invalid_request_error", code: "bad_request" },
  401: { type: "authentication_error", code: "invalid_api_key" },
  402: { type: "billing_error", code: "payment_required" },
  403: { type: "permission_error", code: "insufficient_quota" },
  404: { type: "invalid_request_error", code: "model_not_found" },
  406: { type: "invalid_request_error", code: "model_not_supported" },
  429: { type: "rate_limit_error", code: "rate_limit_exceeded" },
  500: { type: "server_error", code: "internal_server_error" },
  502: { type: "server_error", code: "bad_gateway" },
  503: { type: "server_error", code: "service_unavailable" },
  504: { type: "server_error", code: "gateway_timeout" }
};

// Default error messages per status code (client-facing)
export const DEFAULT_ERROR_MESSAGES = {
  400: "Bad request",
  401: "Invalid API key provided",
  402: "Payment required",
  403: "You exceeded your current quota",
  404: "Model not found",
  406: "Model not supported",
  429: "Rate limit exceeded",
  500: "Internal server error",
  502: "Bad gateway - upstream provider error",
  503: "Service temporarily unavailable",
  504: "Gateway timeout"
};

// Exponential backoff config for rate limits
export const BACKOFF_CONFIG = {
  base: 2000,
  max: 5 * 60 * 1000,
  maxLevel: 15
};

// Default cooldown for transient/unknown errors
export const TRANSIENT_COOLDOWN_MS = 30 * 1000;

// Hard cap for provider-reported rate limit cooldown (e.g. codex resets_at can be 5-6h)
export const MAX_RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;

// A daily/weekly quota is not a rolling rate limit: the provider states exactly
// when it returns, and that can be a week out. Capping such a reset at 30 minutes
// means re-testing a known-dead account ~300 times before it can possibly work,
// paying seconds of upstream latency each time — so honour it far longer.
export const MAX_QUOTA_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

// Cooldown durations (ms)
const COOLDOWN = {
  long: 2 * 60 * 1000,
  short: 5 * 1000,
  // 403 is a permission decision, not congestion. Nothing about waiting two
  // minutes changes it — the account needs an operator. Long enough to stop the
  // retry treadmill, short enough that a re-authorized account returns on its own.
  forbidden: 30 * 60 * 1000,
  // A region block is a 403 whose premise the reasoning above does not hold for:
  // there is no re-authorization, because the model is not served here at all.
  // Thirty minutes just puts it back in rotation to fail identically — the retry
  // treadmill the comment above is trying to prevent, at half-hour intervals.
  // Long enough to stop that, still self-healing if the account opts in.
  region: 24 * 60 * 60 * 1000,
  // A daily or weekly allowance is not congestion either, and backing off in
  // seconds against it is just a slower treadmill. Twelve hours is long enough
  // to stop the retrying and short enough that an upgraded plan returns the
  // model the same day.
  quota: 12 * 60 * 60 * 1000,
};

/**
 * Unified error classification rules.
 * Checked top-to-bottom: text rules first (by order), then status rules.
 * Each rule: { text?, status?, cooldownMs?, backoff? }
 *   - text: substring match (case-insensitive) on error message
 *   - status: HTTP status code match
 *   - cooldownMs: fixed cooldown duration
 *   - backoff: true = use exponential backoff (rate limit)
 */
export const ERROR_RULES = [
  // --- Text-based rules (checked first, order = priority) ---
  // Ahead of the 403 status rule on purpose: a region block is permanent for
  // this deployment, so it must not inherit the transient-forbidden cooldown.
  // Observed 2026-08-15 — ocg/deepseek-v4-pro returned
  //   {"type":"RegionError","message":"The latest version of this model is only
  //    available hosted in China and requires explicit opt in: ..."}
  // which exhausted the Odin combo and surfaced the 403 to the client.
  { text: "regionerror",              cooldownMs: COOLDOWN.region },
  // commandcode returns billing failures as 400 BAD_REQUEST, and 400 has no
  // status rule at all — so it fell to the transient default and was retried
  // every 30 seconds indefinitely. Observed 2026-08-15: 25+ identical locks on
  // cmc/deepseek/deepseek-v4-pro in twelve minutes, each one a round trip
  // spent to be told the account has no credits. Nothing about waiting changes
  // that; the account needs an operator, which is exactly COOLDOWN.forbidden.
  { text: "insufficient credits",     cooldownMs: COOLDOWN.forbidden },
  // The one 400 that IS the account's fault, so it must be matched before the
  // request-scoped status rule below. `disciplineLock` synthesises this status
  // and message when a model crosses the malformed-output strike threshold: the
  // request was fine and the OUTPUT was not, which is a property of the model and
  // the account serving it. Locking is the whole point of that feature, and the
  // status-400 rule would otherwise have silently disarmed it — the failure mode
  // being: a feature keeps its call site, its tests keep passing, and it stops
  // having any effect.
  { text: "malformed model output",   cooldownMs: COOLDOWN.long },
  { text: "no credentials",           cooldownMs: COOLDOWN.long },
  { text: "request not allowed",      cooldownMs: COOLDOWN.short },
  { text: "improperly formed request", cooldownMs: COOLDOWN.long },
  // "weekly usage limit" matched none of the rules below — not "rate limit",
  // not "quota exceeded" — so it fell through to { status: 429, backoff: true }
  // and got a 64-SECOND cooldown for a limit that resets in days. Observed
  // 2026-08-15 on ollama/minimax-m3: "you have reached your weekly usage limit,
  // upgrade for higher limits" · reset after 1m 4s, retried until the client
  // gave up at attempt 6/10. Ahead of the backoff rules so it wins the match.
  { text: "usage limit",              cooldownMs: COOLDOWN.quota },
  // The same condition also arrives as a typed error name with no space, which
  // the rule above cannot see: ollama sends GoUsageLimitError and opencode
  // sends FreeUsageLimitError, both 429, both retried every few seconds because
  // "GoUsageLimitError" does not contain "usage limit". Matching the suffix
  // catches every *UsageLimitError without guessing at vendor prefixes.
  { text: "usagelimiterror",          cooldownMs: COOLDOWN.quota },
  // A DAILY allowance, not congestion. openrouter's free tier answers 429 with
  // "Rate limit exceeded: free-models-per-day", limit_source
  // "openrouter_free_tier_daily", an absolute X-RateLimit-Reset, and a
  // remedy_hint that says "Wait for the daily reset" -- and because the message
  // contains the words "rate limit" it matched the backoff rule below and was
  // retried every couple of minutes. Observed 2026-08-15 on nvidia/z-ai/glm-5.2,
  // retried to attempt 8/10. These two markers must be checked BEFORE the
  // generic "rate limit" rule, since text rules match in order.
  { text: "per-day",                  cooldownMs: COOLDOWN.quota },
  { text: "_daily",                   cooldownMs: COOLDOWN.quota },
  // opencode's monthly wall, seen 2026-08-15 on ocg/qwen3.7-max: "Monthly usage
  // limit reached. Resets in 15 days." Already covered by "usage limit" above,
  // but the quota reset is fifteen days out and twelve hours is the right
  // ceiling either way -- noted so the next reader does not add a fourth rule.
  { text: "rate limit",               backoff: true },
  { text: "too many requests",        backoff: true },
  { text: "quota exceeded",           backoff: true },
  { text: "individual quota",         backoff: true },
  { text: "capacity",                 backoff: true },
  { text: "overloaded",               backoff: true },

  // --- Status-based rules (fallback when text doesn't match) ---
  { status: 401, cooldownMs: COOLDOWN.long },
  { status: 402, cooldownMs: COOLDOWN.long },
  { status: 403, cooldownMs: COOLDOWN.forbidden },
  // A 404 is model_not_found (see ERROR_TYPES): the id we asked for is not one
  // this provider serves. That is registry drift on our side, not congestion on
  // theirs, and it needs an operator to fix the entry — the same premise as the
  // 403 above. Two minutes just schedules the identical failure thirty times an
  // hour. Observed 2026-08-23 in the Yggdrasil cascade at 17:18: three members
  // 404ing in one pass (tokenrouter/deepseek/deepseek-v4-pro-0813-free,
  // tokenrouter/qwen/qwen3.8-max-free, bb/gpt-5.5), all three still in rotation
  // and all three certain to fail again.
  { status: 404, cooldownMs: COOLDOWN.forbidden },
  // 400/406/410 had no status rule, so every one of them fell to the 30-second
  // transient default and came back on the very next request. Observed
  // 2026-08-23, one Yggdrasil cascade at 17:18 walking all 18 in-band entries
  // and all 11 deferred ones before reporting exhaustion:
  //   400  oc/laguna-s-2.1-free, openrouter/poolside/laguna-s-2.1:free,
  //        cf/@cf/deepseek-ai/deepseek-r1-distill-qwen-32b,
  //        groq/llama-3.3-70b-versatile, cmc/deepseek/deepseek-v4-pro,
  //        kr/claude-sonnet-4.5
  //   410  nvidia/z-ai/glm-5.2
  // Eleven of the fifteen real attempts were deterministic client errors, not
  // supply failures — they would fail identically on the next request and did.
  // The cascade nominally 18 deep was about four deep in practice, and the 429
  // the client finally saw came from the last entry standing rather than from
  // any rate limit that mattered.
  //
  // A 400 is this request being wrong for this model — an unsupported field, a
  // schema the provider rejects, a prompt past the real ceiling. Waiting does not
  // fix it, and the file already takes that position: the "improperly formed
  // request" text rule above is COOLDOWN.long.
  //
  // But the cooldown was written against the ACCOUNT, and that is the wrong
  // subject. `markAccountUnavailable` writes `modelLock_<model>` on the
  // connection, and `probeAccountCapacity` reads it for every caller — so one
  // client's malformed request withdrew the model from EVERY concurrent session.
  // Observed 2026-08-26: a single session (558 messages, 119 tool definitions,
  // ~230K tokens) drew 33 opaque 400s from openrouter's Stealth upstream. Each
  // one locked both OpenRouter accounts for two minutes, so `openrouter/stealth/
  // ox-alpha` — the head of Yggdrasil, healthy, and answering other sessions
  // that same minute — was skipped as "no account has capacity for it right now"
  // and the cascade fell through to members that really were out of quota. The
  // client saw a 429 naming opencode-go and concluded its keys were exhausted.
  // 87 of the 154 account locks in a three-hour window were applied for 400s.
  //
  // `requestScoped` keeps the fallback (this request must still move on) and
  // drops the lock (no other request is implicated). The cost is one wasted round
  // trip per offending request instead of a two-minute blackout for every session
  // sharing the account, and a request that is wrong for a reason that outlives
  // it — no credits, wrong model id, revoked key — is not reached by this rule:
  // those arrive as 402/403/404 or match a text rule above.
  { status: 400, requestScoped: true },
  // 406 is model_not_supported (see ERROR_TYPES) and 410 is Gone — both say the
  // model is not served here at all, which is the same premise as a region
  // block. Putting them back in rotation only schedules an identical failure,
  // so they get the region cooldown rather than the transient one.
  { status: 406, cooldownMs: COOLDOWN.region },
  { status: 410, cooldownMs: COOLDOWN.region },
  { status: 429, backoff: true },
];

// Backward compat: COOLDOWN_MS object (used by index.js re-export)
export const COOLDOWN_MS = {
  unauthorized: COOLDOWN.long,
  paymentRequired: COOLDOWN.long,
  notFound: COOLDOWN.long,
  transient: TRANSIENT_COOLDOWN_MS,
  requestNotAllowed: COOLDOWN.short,
};

// A provider that accepts the connection and then goes quiet is the one failure
// the cascade could not see. Nothing below bounded the wait, so a single silent
// upstream consumed the client's entire budget and the remaining combo entries
// were never tried — the request "timed out" with a full pool of untried models
// behind it. Two clocks, because the two silences are different failures: a
// provider can return headers promptly and then never start the stream.
//
// Both are generous on purpose. They exist to break a hang, not to police
// latency: a premature cascade re-sends the prompt to a second provider and
// pays for it twice, so the bound sits well above any honest first-token time,
// including a thinking model's.
// How much of a model's context window a request may occupy before the combo
// asks the client to compact instead of serving it. The operator's rule, stated
// 2026-08-23: "if it will hit rotate and the next model cant handle the context,
// it should compact. if it can handle the context, then compact at 80%."
//
// This lives in the router rather than in the client because only the router
// knows, per request, which members are actually eligible right now — a static
// per-model map in the client goes stale the moment the tuner reorders or a
// member is banned. Both halves of the rule fall out of one number: the ceiling
// is a share of the WIDEST ELIGIBLE window, so as members cool down or exhaust
// their quota the ceiling drops with them, and the client is asked to compact
// before the cascade runs out of anywhere to go.
// `estimateInputTokens` divides the serialized body by 4 chars/token. That is a
// prose average and it is badly wrong for an agent transcript, which is JSON, tool
// schemas, escaped strings and file paths — all of which tokenize far worse.
//
// Measured 2026-08-23, one Yggdrasil request: the router estimated 150,632 tokens
// from 602,528 chars, and the provider answered
//   400 "Input length 391532 exceeds the max..."
// i.e. 1.54 chars/token actual against the assumed 4.0 — a 2.6x underestimate.
// The consequence is not a wrong number in a log. The size check in shouldSkipModel
// reads this estimate, so five members declaring 200K-262K windows were judged able
// to serve a request they could not, each burned a round trip to answer 400, and the
// pool collapsed to the 1M members — which were rate limited. The client saw a 429
// and no rotation, when the real fault was sizing.
//
// Applied ONLY to the size check, never to billing or analytics, and deliberately in
// the conservative direction: over-estimating costs a skip, under-estimating costs a
// wasted round trip and a misleading error. Tune with CONTEXT_ESTIMATE_SAFETY once
// enough observed ratios are logged (see the CTXCAL log line in combo.js).
export const CONTEXT_ESTIMATE_SAFETY = Number(process.env.CONTEXT_ESTIMATE_SAFETY) || 2.5;

export const COMPACT_HEADROOM_RATIO = Number(process.env.COMPACT_HEADROOM_RATIO) || 0.8;

export const COMBO_RESPONSE_TIMEOUT_MS = Number(process.env.COMBO_RESPONSE_TIMEOUT_MS) || 90 * 1000;
export const COMBO_FIRST_EVENT_TIMEOUT_MS = Number(process.env.COMBO_FIRST_EVENT_TIMEOUT_MS) || 150 * 1000;
