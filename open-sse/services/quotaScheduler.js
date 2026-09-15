/**
 * Quota-weighted account scoring.
 *
 * Motivation (the "1000 points / 10 days vs 2000 points / 15 days" case): fill-first
 * always drains the highest-priority account to zero, which can let a small,
 * soon-expiring package go unused while a larger, later-expiring one is consumed
 * first. Naive round-robin ignores the amounts entirely.
 *
 * This module produces a comparable score per account from two heterogeneous
 * quantities with DIFFERENT UNITS:
 *   - remaining quota (points / percent / tokens — provider dependent)
 *   - time-to-expiry (ms)
 * Applying weights directly to raw values is dimensionally wrong (a 1e6-token
 * balance would swamp a 1e9-ms expiry or vice versa). So each axis is first
 * MIN-MAX NORMALISED across the CURRENT candidate set into [0,1], and only then
 * weighted. This keeps the two weights meaningful regardless of scale.
 *
 * score = wRemaining * norm(remaining) + wExpiry * norm(expiryUrgency)
 *
 *   norm(remaining): higher remaining → higher score (favour fuller accounts so we
 *                    consume the ones with headroom first; combined with urgency
 *                    this naturally drains soon-expiring balances).
 *   norm(expiryUrgency): sooner expiry → higher urgency → higher score (when
 *                    quotaPreferEarlierExpiry is true, burn the soon-expiring
 *                    balance before it is wasted).
 *
 * Callers must pass a `getQuota(connection)` accessor returning
 * `{ remaining, total, resetAtMs } | null`. Accounts with no quota data score
 * NEUTRAL (0.5/0.5 blend) so they are neither starved nor unfairly preferred.
 */

const NEUTRAL = 0.5;

function minMax(values) {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 0, span: 0 };
  return { min, max, span: max - min };
}

/** Normalise x into [0,1] given min/span; returns NEUTRAL when span is 0 (all equal). */
function norm(x, min, span) {
  if (!Number.isFinite(x)) return NEUTRAL;
  if (span <= 0) return NEUTRAL;
  return Math.min(1, Math.max(0, (x - min) / span));
}

/**
 * Score a list of candidate connections.
 *
 * @param {Array<object>} candidates
 * @param {object} opts
 * @param {(c: object) => {remaining:number,total?:number,resetAtMs?:number}|null} opts.getQuota
 * @param {number} [opts.weightRemaining=1]
 * @param {number} [opts.weightExpiry=0.5]
 * @param {boolean} [opts.preferEarlierExpiry=true]
 * @param {() => number} [opts.now=Date.now]
 * @param {(c: object) => number} [opts.getLoad] - in-flight load, used as a tie-breaker
 * @returns {Array<{ connection: object, score: number, detail: object }>} sorted best-first
 */
export function scoreAccounts(candidates, opts = {}) {
  const {
    getQuota,
    weightRemaining = 1,
    weightExpiry = 0.5,
    preferEarlierExpiry = true,
    now = () => Date.now(),
    getLoad = null,
  } = opts;

  const n = now();
  const quotaList = candidates.map((c) => (typeof getQuota === "function" ? getQuota(c) : null));

  const remainingValues = quotaList.map((q) => (q && Number.isFinite(q.remaining) ? q.remaining : NaN));
  const expiryValues = quotaList.map((q) => {
    if (!q || !Number.isFinite(q.resetAtMs)) return NaN;
    // Convert to "urgency": sooner expiry → LARGER value, so a single max/min path
    // handles both directions. Use seconds-until-expiry inverted.
    return -q.resetAtMs;
  });

  const rem = minMax(remainingValues);
  const exp = minMax(expiryValues);

  const scored = candidates.map((connection, i) => {
    const q = quotaList[i];
    let scoreRemaining = NEUTRAL;
    let scoreExpiry = NEUTRAL;

    if (q && Number.isFinite(q.remaining)) {
      scoreRemaining = norm(q.remaining, rem.min, rem.span);
    }
    if (q && Number.isFinite(q.resetAtMs)) {
      // Higher urgency value == earlier expiry. With preferEarlierExpiry=false we
      // invert so later-expiring accounts (more runway) are preferred instead.
      const urgency = norm(-q.resetAtMs, exp.min, exp.span);
      scoreExpiry = preferEarlierExpiry ? urgency : 1 - urgency;
    }

    let score = weightRemaining * scoreRemaining + weightExpiry * scoreExpiry;
    // Small load penalty (pure tie-breaker, bounded well below one weight unit)
    // so equally-scored accounts pick the least busy one.
    const load = typeof getLoad === "function" ? getLoad(connection.id) : 0;
    if (load > 0) score -= Math.min(0.1, load * 0.01);

    return {
      connection,
      score,
      detail: {
        hasQuota: !!q,
        remaining: q?.remaining ?? null,
        resetAtMs: q?.resetAtMs ?? null,
        scoreRemaining,
        scoreExpiry,
        load,
        msUntilExpiry: q && Number.isFinite(q.resetAtMs) ? q.resetAtMs - n : null,
      },
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/**
 * Pick the single best account by quota-weighted score.
 *
 * `score` is returned alongside `detail` because callers log it; it lives on the
 * scored entry (a sibling of `detail`), not inside `detail`.
 *
 * @returns {{ connection: object|null, score: number|null, detail: object|null }}
 */
export function pickQuotaWeighted(candidates, opts = {}) {
  if (!candidates || candidates.length === 0) return { connection: null, score: null, detail: null };
  const ranked = scoreAccounts(candidates, opts);
  const best = ranked[0];
  return { connection: best.connection, score: best.score, detail: best.detail };
}

// ---------------------------------------------------------------------------
// Optimistic local consumption
//
// The quota snapshot / Antigravity cache is inherently stale (it is refreshed on
// a timer or on error). If N concurrent requests all score against the SAME
// snapshot they all pick the same "best" account, which defeats the purpose and
// re-creates the thundering-herd problem (audit item #6). To damp this, we apply
// a short-lived LOCAL decrement per selection: the chosen account's effective
// remaining quota is lowered immediately, so the next selector that runs within
// the decay window sees a less attractive account and spreads out. The decrement
// is purely advisory and self-heals as entries expire.
// ---------------------------------------------------------------------------

const optimistic = new Map(); // connectionId -> { used, expiresAt }
const OPTIMISTIC_TTL_MS = 30_000;

function optimisticUsed(connectionId, now) {
  const e = optimistic.get(connectionId);
  if (!e) return 0;
  if (e.expiresAt <= now) {
    optimistic.delete(connectionId);
    return 0;
  }
  return e.used;
}

/**
 * Record that `connectionId` was just selected, so concurrent selectors within
 * the decay window discount its apparent remaining quota.
 * @param {string} connectionId
 * @param {number} [cost=1] - units to discount (default: one "slot")
 */
export function recordConsumption(connectionId, cost = 1) {
  if (!connectionId) return;
  const now = Date.now();
  const e = optimistic.get(connectionId);
  if (!e || e.expiresAt <= now) {
    optimistic.set(connectionId, { used: cost, expiresAt: now + OPTIMISTIC_TTL_MS });
    return;
  }
  e.used += cost;
  optimistic.set(connectionId, e);
}

/**
 * Wrap a getQuota accessor so it returns the snapshot MINUS the optimistic local
 * decrement. The decrement is expressed as a fraction of the snapshot's total
 * (or a small absolute floor when no total is known), so it perturbs scoring
 * without inventing wildly out-of-range values.
 *
 * @param {(c: object) => {remaining:number,total?:number,resetAtMs?:number}|null} getQuota
 * @returns {(c: object) => object|null}
 */
export function withOptimisticDiscount(getQuota) {
  return (c) => {
    const q = typeof getQuota === "function" ? getQuota(c) : null;
    if (!q) return null;
    const now = Date.now();
    const used = optimisticUsed(c?.id, now);
    if (!used) return q;
    const total = Number.isFinite(q.total) && q.total > 0 ? q.total : null;
    // Discount = used units of the total when known, else 2% of remaining per unit.
    const discount = total ? Math.min(q.remaining, used) : Math.min(q.remaining * 0.02 * used, q.remaining * 0.5);
    return { ...q, remaining: Math.max(0, q.remaining - discount), optimisticUsed: used };
  };
}

/**
 * Roll back a previously recorded optimistic consumption.
 *
 * `recordConsumption` is applied at SELECTION time, before we know whether the
 * request will actually consume anything. When the attempt fails without
 * consuming quota (a concurrency-429 retry, or a failover to another account),
 * the discount is stale: it makes a perfectly healthy account look emptier than
 * it is for the remainder of the decay window, biasing subsequent selections
 * away from it for no reason.
 *
 * Refunding keeps the optimistic view honest. The counter is clamped at zero and
 * the entry is dropped when it reaches zero, so an unmatched refund can never
 * drive the discount negative (which would make an account look artificially
 * attractive).
 *
 * @param {string} connectionId
 * @param {number} [cost=1] - units to refund; must mirror the recorded cost
 */
export function releaseConsumption(connectionId, cost = 1) {
  if (!connectionId) return;
  const e = optimistic.get(connectionId);
  if (!e) return;
  if (e.expiresAt <= Date.now()) {
    // Already decayed; nothing to refund.
    optimistic.delete(connectionId);
    return;
  }
  e.used -= cost;
  if (e.used <= 0) {
    optimistic.delete(connectionId);
    return;
  }
  optimistic.set(connectionId, e);
}

/** Clear optimistic state (test helper / maintenance). */
export function resetOptimistic() {
  optimistic.clear();
}

/** Current optimistic discount units for a connection (diagnostics / tests). */
export function getOptimisticUsed(connectionId) {
  if (!connectionId) return 0;
  return optimisticUsed(connectionId, Date.now());
}
