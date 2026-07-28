// Quota exhaustion is different from a transient cooldown: a 429 with a daily
// or monthly quota message means the model is gone for hours, not seconds, and
// a combo should stop putting it at the head of the cascade. Kept separate from
// modelCooldown so a short rate-limit backoff never gets promoted into an
// hours-long exclusion by accident.

const QUOTA_TTL_MS = 60 * 60 * 1000;

const exhausted = new Map();

// Matches the phrasings providers actually use for hard quota exhaustion, as
// opposed to per-minute rate limiting which is a normal cooldown.
const QUOTA_TEXT = /(quota|billing|insufficient balance|credit|out of credits|exceeded your current quota|free tier|daily limit|monthly limit)/i;
const RATE_TEXT = /(rate limit|too many requests|requests per (minute|second)|slow down)/i;

export function isQuotaExhaustion(status, errorText) {
  const text = String(errorText || "");
  if (status === 402) return true;
  if (status !== 429) return false;
  if (RATE_TEXT.test(text) && !QUOTA_TEXT.test(text)) return false;
  return QUOTA_TEXT.test(text);
}

export function markQuotaExhausted(model, now = Date.now(), ttlMs = QUOTA_TTL_MS) {
  if (!model) return;
  exhausted.set(model, now + ttlMs);
}

export function isQuotaExhausted(model, now = Date.now()) {
  const until = exhausted.get(model);
  if (!until) return false;
  if (until <= now) {
    exhausted.delete(model);
    return false;
  }
  return true;
}

export function quotaRemainingMs(model, now = Date.now()) {
  const until = exhausted.get(model);
  return until && until > now ? until - now : 0;
}

export function clearQuotaState() {
  exhausted.clear();
}
