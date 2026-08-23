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
 * of tokens to Gemini and to Claude. A global blend serves the sizing decision in
 * combo.js, which runs before any provider is chosen.
 */

// Exponential moving average. Low alpha because the ratio is a property of the
// client's traffic shape, which changes slowly; a single odd request should not
// move it far.
const ALPHA = 0.2;

// Until a provider has been observed, fall back to the global blend, and until
// THAT exists, to this. 1.6 = the old 4.0 constant divided by the 2.5 safety
// factor it needed in practice — i.e. the stopgap this module replaces.
const BOOTSTRAP_CHARS_PER_TOKEN = 1.6;

// Guard rails. A ratio outside this band is not a tokenizer, it is a bug — a
// truncated body, a cached-token accounting mismatch, a provider reporting zero.
const MIN_RATIO = 0.5;
const MAX_RATIO = 8;

// Below this the sample is noise: a tiny request's fixed overhead dominates.
const MIN_SAMPLE_CHARS = 2000;

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
 * blend, else the bootstrap.
 */
export function charsPerToken(provider = null) {
  if (provider) {
    const p = byProvider.get(provider);
    if (p && p.samples > 0) return p.ratio;
  }
  return global.ratio;
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
