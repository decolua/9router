// Sliding one-minute usage windows.
//
// Used for two things: the per-account request cap below, and the per-API-key
// RPM/TPM caps (which count tokens, not just requests -- hence the amount).
//
// Providers like NVIDIA NIM enforce a per-key RPM limit and answer 429 once it
// is crossed, which then parks the whole account on a cooldown. Counting our
// own requests and skipping to the next account before the limit is reached
// keeps the pool inside the provider's budget instead of learning about it
// from an error.
//
// ponytail: in-process counters, so each 9router instance gets its own budget.
// Move to the DB/Redis if this ever runs multi-instance behind a load balancer.

const WINDOW_MS = 60_000;

/** id -> array of { t, n } entries inside the current window */
const hits = new Map();

function prune(connectionId, now) {
  const list = hits.get(connectionId);
  if (!list) return [];
  const cutoff = now - WINDOW_MS;
  // Timestamps are appended in order, so drop from the front.
  let i = 0;
  while (i < list.length && list[i].t <= cutoff) i += 1;
  const kept = i === 0 ? list : list.slice(i);
  if (kept.length) hits.set(connectionId, kept);
  else hits.delete(connectionId);
  return kept;
}

/** Units (requests, or tokens) used by this id in the last minute. */
export function usage(connectionId, now = Date.now()) {
  return prune(connectionId, now).reduce((sum, e) => sum + e.n, 0);
}

/** True when the account has already used its whole minute budget. */
export function isOverLimit(connectionId, limit, now = Date.now()) {
  if (!limit || limit <= 0) return false; // 0 / unset == unlimited
  return usage(connectionId, now) >= limit;
}

/** Count usage against an id: amount is 1 for a request, or a token count. */
export function recordRequest(connectionId, amount = 1, now = Date.now()) {
  if (!connectionId) return;
  if (!(amount > 0)) return;
  const list = prune(connectionId, now);
  list.push({ t: now, n: amount });
  hits.set(connectionId, list);
}

/**
 * When the oldest request in the window ages out, i.e. when this account gets
 * capacity back. Null when it is not currently at the limit.
 */
export function retryAfterMs(connectionId, limit, now = Date.now()) {
  if (!isOverLimit(connectionId, limit, now)) return null;
  const list = hits.get(connectionId) || [];
  const oldest = list[0];
  if (!oldest) return null;
  return Math.max(0, oldest.t + WINDOW_MS - now);
}

/** Test seam. */
export function _reset() {
  hits.clear();
}
