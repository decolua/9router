/**
 * Learned chars-per-token ratios.
 *
 * Sizing a request — deciding which combo members can hold it — has to happen
 * BEFORE the request is sent, and only the provider can count exactly. So the
 * first estimate is unavoidably a guess. What was avoidable is guessing forever:
 * every response carries the provider's real input_tokens, the router already
 * reads it for billing, and it was then discarded. This module feeds it back.
 *
 * Measured 2026-08-23, the incident that motivated this: a 602,528-char body was
 * estimated at 150,632 tokens (the hardcoded 4 chars/token) and measured by the
 * provider at 391,532 — 1.54 chars/token actual. Members declaring 200K windows
 * were judged able to serve it, each spent a round trip to answer 400, and the
 * cascade drained to a 429 that looked like a rotation failure.
 *
 * Per provider, because tokenizers differ: the same text is not the same number
 * of tokens to Gemini and to Claude.
 *
 * SIZING DOES NOT USE THE BLEND — and the first version of this module was wrong
 * about that. A single global mean, fed by whichever provider happened to answer
 * last, is a feedback loop: the estimate picks the member, that member's
 * tokenizer produces the next sample, the sample moves the estimate, which picks
 * a different member next time. Measured in production on 2026-08-23, over eight
 * minutes and one unchanged conversation:
 *
 *     23:42:14  chars=590497  ratio=4.00  ->  estimate 150,784
 *     23:42:42  chars=596279  ratio=2.50  ->  estimate 243,466
 *     23:44:14  chars=604242  ratio=2.01  ->  estimate 305,373
 *     23:45:04                ratio=1.84     (floor)
 *     23:49:07                ratio=3.63     (ceiling)
 *
 * The same 600k-char body sized at 150k tokens and at 305k tokens — a 2x spread
 * against a hard 200k cliff, so members flipped in and out of eligibility every
 * turn. When it landed high, 200k members were judged able to hold a 400k request,
 * each spent a round trip to answer 400, the cascade drained, and the client's
 * compaction request came back an error — which Claude Code answers by abandoning
 * compaction and carrying on with a full context. The conversation then cannot
 * shrink, which is the one failure this whole path exists to prevent.
 *
 * So sizing takes the most PESSIMISTIC ratio observed, not the average one. The
 * asymmetry is deliberate and it is not close: sizing low skips a member that
 * might have coped, which costs one position in a cascade of eighteen; sizing
 * high spends a round trip per member and can drain the combo. Under-counting
 * tokens is the expensive mistake, so the number that can only over-count wins.
 */

// Exponential moving average. Low alpha because the ratio is a property of the
// client's traffic shape, which changes slowly; a single odd request should not
// move it far.
const ALPHA = 0.2;

// Until a provider has been observed, fall back to the global blend, and until
// THAT exists, to this.
//
// This was 1.6, derived as "the old 4.0 constant divided by the 2.5 safety factor"
// — an arithmetic leftover, never measured. It matters far more than it looks,
// because the learned ratios live in memory and reset to this on every restart:
// each deploy re-enters the pessimistic state for the first three requests per
// provider, and those are exactly the requests that skip members and drain a
// combo.
//
// Measured on real traffic 2026-08-26, the same body that had just been sized at
// 253,280 tokens:
//
//     openrouter/poolside/laguna-s-2.1:free   392,446 chars -> 104,824 tokens
//                                             = 3.74 chars/token
//
// 2.5 keeps the pessimistic bias the module argues for — it still over-counts
// that body by 66% — while staying inside the band a tokenizer can actually
// occupy. Dense JSON and tool schemas run about 2.0; this sits just above that
// and well below the 3.74 observed, so it errs high without erring absurdly.
const BOOTSTRAP_CHARS_PER_TOKEN = 2.5;

// Guard rails. A ratio outside this band is not a tokenizer, it is a bug — a
// truncated body, a cached-token accounting mismatch, a provider reporting zero.
//
// The floor was 0.5, which is below anything a tokenizer can do and so caught
// none of the bugs it was written for. Measured 2026-08-26: antigravity reported
// 458,135 input tokens for a body this module measured at 466,255 chars — a ratio
// of 1.02, accepted, and because sizingCharsPerToken takes the MINIMUM across
// providers, that one number then sized every request in every cascade. A 133K
// conversation was sized at 684,446 tokens, every member under a megatoken was
// skipped for window, and the combo reported exhaustion with a pool that could
// have served it.
//
// The cause is not a tokenizer at all: `chars` is measured with media stripped
// and Gemini counts media as tokens, so the sample compares two different bodies.
// The real repair is to stop sampling requests whose media was stripped; this
// floor is the guard that makes such a sample impossible to trust in the meantime.
//
// 1.5 is chosen to sit above the observed 1.02 and below any real tokenizer on
// this traffic — dense JSON and code run 2.0 and up, English 3.5 to 4. It would
// wrongly reject genuine CJK text, which can approach 1.0 chars per token. That
// trade is deliberate: rejecting a sample costs nothing (the ratio falls back to
// other providers), while accepting a false one poisons the pool minimum until
// the process restarts.
const MIN_RATIO = 1.5;
const MAX_RATIO = 8;

// Below this the sample is noise: a tiny request's fixed overhead dominates.
const MIN_SAMPLE_CHARS = 2000;

// A provider speaks for itself only once it has been seen more than once. One
// sample is an anecdote, and because sizing takes the minimum across providers,
// a single freak observation would otherwise set the number for everybody.
const MIN_SAMPLES_TO_TRUST = 3;

// Applied to the sizing ratio only, never to the recorded one. A smaller ratio
// means more tokens, so this buys headroom against the gap between the body we
// measure and the body the provider counts — translation rewrites it, the system
// prompt is injected after, and RTK may compress tool results. 10% is the margin
// the observed spread needs; it is not a fudge for an unmeasured quantity, which
// is what CONTEXT_ESTIMATE_SAFETY was.
const SIZING_MARGIN = 0.9;

/** @type {Map<string, { ratio: number, samples: number }>} */
const byProvider = new Map();
let global = { ratio: BOOTSTRAP_CHARS_PER_TOKEN, samples: 0 };

function blend(prev, observed, samples) {
  // First real sample replaces the bootstrap outright rather than averaging
  // against a number that was never measured.
  if (samples === 0) return observed;
  return prev + ALPHA * (observed - prev);
}

/**
 * Record one observation. Silently ignores anything that cannot be a real ratio.
 * @param {string} provider
 * @param {number} chars serialized body length, media stripped
 * @param {number} realTokens provider-reported input tokens, cache-inclusive
 */
export function observeTokenRatio(provider, chars, realTokens) {
  if (!Number.isFinite(chars) || !Number.isFinite(realTokens)) return;
  if (chars < MIN_SAMPLE_CHARS || realTokens <= 0) return;
  const observed = chars / realTokens;
  if (observed < MIN_RATIO || observed > MAX_RATIO) return;

  const key = provider || "unknown";
  const prev = byProvider.get(key) || { ratio: BOOTSTRAP_CHARS_PER_TOKEN, samples: 0 };
  byProvider.set(key, { ratio: blend(prev.ratio, observed, prev.samples), samples: prev.samples + 1 });
  global = { ratio: blend(global.ratio, observed, global.samples), samples: global.samples + 1 };
}

/**
 * Chars per token to divide by. Provider-specific when known, else the global
 * blend, else the bootstrap. This is the descriptive number — what we believe
 * the tokenizer actually does. Use it for reporting, not for deciding whether a
 * member can hold a request; see sizingCharsPerToken for that.
 */
export function charsPerToken(provider = null) {
  if (provider) {
    const p = byProvider.get(provider);
    if (p && p.samples > 0) return p.ratio;
  }
  return global.ratio;
}

/**
 * The ratio to size a request with: the most token-hungry tokenizer we have
 * actually observed, with a margin, so the estimate errs high.
 *
 * When the provider is known this is that provider's own ratio — nothing is
 * blended, and the feedback loop described at the top of this file cannot form.
 * When it is not — combo.js sizes once for the whole cascade, before any member
 * is chosen — it is the MINIMUM across every provider with enough samples to
 * speak. Minimum, not mean: the request has to fit whichever member ends up
 * serving it, so the pool's worst case is the only honest number, and a minimum
 * over a stable set barely moves even while the individual means drift.
 */
export function sizingCharsPerToken(provider = null) {
  if (provider) {
    const p = byProvider.get(provider);
    if (p && p.samples >= MIN_SAMPLES_TO_TRUST) return p.ratio * SIZING_MARGIN;
  }
  let worst = null;
  for (const p of byProvider.values()) {
    if (p.samples < MIN_SAMPLES_TO_TRUST) continue;
    if (worst === null || p.ratio < worst) worst = p.ratio;
  }
  if (worst !== null) return clampSizing(worst * SIZING_MARGIN);
  return clampSizing((global.samples > 0 ? global.ratio : BOOTSTRAP_CHARS_PER_TOKEN) * SIZING_MARGIN);
}

// One provider's number becomes the whole pool's number here, so state the floor
// as an invariant rather than trusting every future caller of observeTokenRatio
// to have filtered correctly. Lowering MIN_RATIO again would otherwise silently
// re-open the 2026-08-26 failure, which was invisible from outside: a healthy
// pool, no errors on the members, and a combo reporting exhaustion.
function clampSizing(ratio) {
  const floor = MIN_RATIO * SIZING_MARGIN;
  return ratio < floor ? floor : ratio;
}

/** True once at least one provider has spoken often enough to be trusted. */
export function isSizingCalibrated(provider = null) {
  if (provider) {
    const p = byProvider.get(provider);
    if (p && p.samples >= MIN_SAMPLES_TO_TRUST) return true;
  }
  for (const p of byProvider.values()) if (p.samples >= MIN_SAMPLES_TO_TRUST) return true;
  return false;
}

/** True once the number in use is measured rather than assumed. */
export function isCalibrated(provider = null) {
  if (provider) {
    const p = byProvider.get(provider);
    if (p && p.samples > 0) return true;
  }
  return global.samples > 0;
}

/** Introspection for logs and tests. */
export function ratioStats() {
  return {
    global: { ...global },
    providers: Object.fromEntries([...byProvider].map(([k, v]) => [k, { ...v }])),
  };
}

/** Test helper. */
export function resetTokenRatios() {
  byProvider.clear();
  global = { ratio: BOOTSTRAP_CHARS_PER_TOKEN, samples: 0 };
}
