// Pure helpers for the per-(connection, model) rate-limit feature (RPM/RPD/TPM/TPD).
//
// Default is unlimited: a value only takes effect once explicitly configured,
// either on the key itself (connection.rateLimits[model]) or as a group default
// (settings.groupRateLimits[group][model]). Nothing here touches the database —
// callers read/write the actual counters via connectionsRepo's
// bumpRateLimitCounters, which does an atomic read-modify-write per (connection,
// model) so concurrent callers never lose an increment (see its doc comment).
//
// Windows are rolling, not calendar-fixed: a key's RPD window starts on its
// first request and resets exactly 24h later, rather than at a fixed wall-clock
// boundary. This sidesteps having to know each provider's actual reset timezone
// (Gemini resets around midnight Pacific, others differ) — since this is a soft,
// proactive-avoidance signal and not the sole enforcement (a real 429 from the
// provider still falls back via the existing accountFallback/backoff path), being
// slightly out of phase with the provider's own clock isn't harmful.
//
// RPM/RPD vs TPM/TPD is an important asymmetry:
// - RPM/RPD count REQUESTS, known the instant a connection is selected — bumped
//   optimistically via nextStateForRequest() right before dispatch.
// - TPM/TPD count TOKENS, only known after a response finishes — bumped via
//   nextStateForTokens() post-hoc, once actual usage is reported. Enforcement for
//   token limits is therefore always one request behind: a key already over its
//   TPM/TPD budget gets skipped for the NEXT request, not the one that pushed it
//   over. That's an inherent limit of the token model itself (providers work the
//   same way — they can't precheck a response's own token count either).

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function hasAnyLimit(l) {
  return !!(l && (l.rpm || l.rpd || l.tpm || l.tpd));
}

/**
 * Resolve the effective { rpm, rpd, tpm, tpd } for one (connection, model) pair.
 * The key's own override wins outright (even if only some fields are set —
 * no merging with the group default, to keep resolution simple to reason about);
 * otherwise fall back to the connection's group default. Returns null if neither
 * is configured (unlimited).
 */
export function resolveRateLimits(connection, model, groupRateLimits) {
  if (!model) return null;
  const own = connection?.rateLimits?.[model];
  if (hasAnyLimit(own)) return own;
  const group = (connection?.group || "").trim();
  if (!group) return null;
  const fallback = groupRateLimits?.[group]?.[model];
  return hasAnyLimit(fallback) ? fallback : null;
}

// Roll a single window forward by `incrementBy`. If the window has elapsed (or
// never started), it resets to a fresh window starting now instead of carrying
// over a stale count. Returns the next persisted shape — never mutates input.
function rollWindow(prevStart, prevCount, windowMs, incrementBy) {
  const now = Date.now();
  const elapsed = prevStart ? now - new Date(prevStart).getTime() : Infinity;
  if (elapsed >= windowMs) {
    return { windowStart: new Date(now).toISOString(), count: incrementBy };
  }
  return { windowStart: prevStart, count: (prevCount || 0) + incrementBy };
}

// Is this window already at/over its limit? An elapsed window always reads as
// "not over" (it would reset on the next actual bump) — never blocks on stale data.
function overLimit(windowStart, count, windowMs, limit) {
  if (!limit || !windowStart) return false;
  if (Date.now() - new Date(windowStart).getTime() >= windowMs) return false;
  return (count || 0) >= limit;
}

/**
 * True if `connection` should be skipped for `model` right now because it's
 * already at/over any of its configured RPM/RPD/TPM/TPD. Meant to be checked
 * alongside isModelLockActive() when filtering candidates for selection.
 */
export function isRateLimitBlocked(connection, model, groupRateLimits) {
  const limits = resolveRateLimits(connection, model, groupRateLimits);
  if (!limits) return false;
  const state = connection?.rateLimitState?.[model] || {};
  return (
    overLimit(state.rpmWindowStart, state.rpmCount, MINUTE_MS, limits.rpm) ||
    overLimit(state.rpdWindowStart, state.rpdCount, DAY_MS, limits.rpd) ||
    overLimit(state.tpmWindowStart, state.tpmCount, MINUTE_MS, limits.tpm) ||
    overLimit(state.tpdWindowStart, state.tpdCount, DAY_MS, limits.tpd)
  );
}

/**
 * Next rateLimitState[model] fields after one more request is about to be sent.
 * Call right when a connection is chosen, before dispatch (RPM/RPD only — token
 * count for THIS request isn't known yet). Returns null if neither RPM nor RPD
 * is configured, so callers can skip the write entirely for keys with no limit.
 */
export function nextStateForRequest(connection, model, groupRateLimits) {
  const limits = resolveRateLimits(connection, model, groupRateLimits);
  if (!limits || (!limits.rpm && !limits.rpd)) return null;
  const state = connection?.rateLimitState?.[model] || {};
  const patch = {};
  if (limits.rpm) {
    const rpm = rollWindow(state.rpmWindowStart, state.rpmCount, MINUTE_MS, 1);
    patch.rpmWindowStart = rpm.windowStart;
    patch.rpmCount = rpm.count;
  }
  if (limits.rpd) {
    const rpd = rollWindow(state.rpdWindowStart, state.rpdCount, DAY_MS, 1);
    patch.rpdWindowStart = rpd.windowStart;
    patch.rpdCount = rpd.count;
  }
  return patch;
}

/**
 * Next rateLimitState[model] fields once a request's actual token usage is
 * known. Call after the response finishes. Returns null if neither TPM nor TPD
 * is configured, or there were no tokens to add.
 */
export function nextStateForTokens(connection, model, groupRateLimits, tokensUsed) {
  if (!tokensUsed) return null;
  const limits = resolveRateLimits(connection, model, groupRateLimits);
  if (!limits || (!limits.tpm && !limits.tpd)) return null;
  const state = connection?.rateLimitState?.[model] || {};
  const patch = {};
  if (limits.tpm) {
    const tpm = rollWindow(state.tpmWindowStart, state.tpmCount, MINUTE_MS, tokensUsed);
    patch.tpmWindowStart = tpm.windowStart;
    patch.tpmCount = tpm.count;
  }
  if (limits.tpd) {
    const tpd = rollWindow(state.tpdWindowStart, state.tpdCount, DAY_MS, tokensUsed);
    patch.tpdWindowStart = tpd.windowStart;
    patch.tpdCount = tpd.count;
  }
  return patch;
}
