import { getProviderConnections, validateApiKey, updateProviderConnection, getSettings, getProxyPools } from "@/lib/localDb";
import { resolveConnectionProxyConfig, pickProxyPoolId } from "@/lib/network/connectionProxy";
import { formatRetryAfter, checkFallbackError, isConcurrencyLimited, isModelLockActive, buildModelLockUpdate, getEarliestModelLockUntil } from "open-sse/services/accountFallback.js";
import { MAX_RATE_LIMIT_COOLDOWN_MS } from "open-sse/config/errorConfig.js";
import { resolveProviderId, FREE_PROVIDERS } from "@/shared/constants/providers.js";
import { getAntigravityQuotaCache } from "./antigravityQuota.js";
import { acquire as acquireAccountSlot, release as releaseAccountSlotInternal, getLoad, DEFAULT_MAX_CONCURRENT_PER_ACCOUNT } from "open-sse/services/accountLoad.js";
import { getBoundConnection, bindSession, getSessionCount, startSessionBindingSweeper } from "open-sse/services/sessionBindings.js";
import { pickQuotaWeighted, withOptimisticDiscount, recordConsumption, releaseConsumption } from "open-sse/services/quotaScheduler.js";
import * as log from "../utils/logger.js";

// Mutex to prevent race conditions during account selection.
//
// Sharded per-provider: a single global mutex serialised selection across ALL
// providers, so a slow provider (DNS/DB round-trips inside the section) blocked
// unrelated providers. One promise chain per provider keeps ordering guarantees
// where they matter (same-provider lastUsedAt / use-count updates) without the
// cross-provider head-of-line blocking (audit item #8).
const selectionMutexes = new Map(); // providerId -> Promise

function acquireSelectionMutex(providerId) {
  const key = providerId || "__global__";
  const current = selectionMutexes.get(key) || Promise.resolve();
  let release;
  const next = new Promise((resolve) => { release = resolve; });
  selectionMutexes.set(key, next);
  return { current, release };
}

// Re-applies the sweeper settings whenever they change.
//
// A one-shot `started` boolean would pin the very first values read at startup,
// so editing "Idle Release (minutes)" / the sweep interval in the dashboard had no
// effect until the process restarted. startSessionBindingSweeper() is itself a
// no-op when the parameters are unchanged, so calling this per selection is cheap;
// we still memoise the last pair to avoid the function-call churn on the hot path.
let lastSweeperTtl = null;
let lastSweeperInterval = null;
function ensureSessionSweeper(settings) {
  const ttl = settings?.sessionIdleTtlMs || 30 * 60 * 1000;
  const interval = settings?.sessionBindingSweepIntervalMs || 5 * 60 * 1000;
  if (ttl === lastSweeperTtl && interval === lastSweeperInterval) return;
  lastSweeperTtl = ttl;
  lastSweeperInterval = interval;
  startSessionBindingSweeper(ttl, interval);
}

/**
 * Resolve a comparable quota descriptor for an account, for quota-weighted
 * scheduling. Sources, in order:
 *   1. Antigravity live quota cache (per-model remaining percentage + resetAt)
 *   2. providerSpecificData.quota snapshot ({"remaining","total","resetAt"})
 * Returns null when nothing is known — the scheduler then scores it neutral.
 */
function resolveAccountQuota(connection, providerId, model) {
  if (providerId === "antigravity" && model) {
    const cache = getAntigravityQuotaCache();
    const q = cache?.get(connection.id)?.[model];
    if (q) {
      const resetAtMs = q.resetAt ? new Date(q.resetAt).getTime() : NaN;
      return {
        remaining: Number.isFinite(q.remainingPercentage) ? q.remainingPercentage : NaN,
        total: 100,
        resetAtMs,
      };
    }
  }
  const snap = connection.providerSpecificData?.quota;
  if (snap && typeof snap === "object") {
    const resetAtMs = snap.resetAt ? new Date(snap.resetAt).getTime() : NaN;
    const remaining = Number(snap.remaining);
    if (Number.isFinite(remaining)) {
      return { remaining, total: Number(snap.total) || null, resetAtMs };
    }
  }
  return null;
}

const GITHUB_MONTHLY_USAGE_LIMIT = "you've reached your additional usage limit for your plan";

function githubMonthlyResetMs(status, errorText, provider) {
  if (resolveProviderId(provider) !== "github" || Number(status) !== 402) return null;
  if (!String(errorText || "").toLowerCase().includes(GITHUB_MONTHLY_USAGE_LIMIT)) return null;
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
}

/**
 * Get provider credentials from localDb
 * Filters out unavailable accounts and returns the selected account based on strategy
 * @param {string} provider - Provider name
 * @param {Set<string>|string|null} excludeConnectionIds - Connection ID(s) to exclude (for retry with next account)
 * @param {string|null} model - Model name for per-model rate limit filtering
 */
export async function getProviderCredentials(provider, excludeConnectionIds = null, model = null, options = {}) {
  // Normalize to Set for consistent handling
  const excludeSet = excludeConnectionIds instanceof Set
    ? excludeConnectionIds
    : (excludeConnectionIds ? new Set([excludeConnectionIds]) : new Set());
  const preferredConnectionId = options?.preferredConnectionId || null;
  // Optional session identity for affinity binding. `sessionId` must be a stable
  // per-conversation id (see open-sse/utils/sessionManager.js resolveSessionIdentity).
  const sessionId = options?.sessionId || null;
  // Whether the caller wants a concurrency slot reserved for this selection.
  //
  // This is OPT-IN on purpose. A reserved slot must be released by the caller via
  // releaseAccountSlot(); any caller that acquires without releasing would leak the
  // counter permanently, eventually making every account look saturated and
  // cascading into spurious CONCURRENCY_LIMITED responses. Only callers that
  // actually manage the slot lifecycle in a try/finally (currently chat.js) pass
  // reserveSlot: true.
  const reserveSlot = options?.reserveSlot === true;
  // Resolve alias to provider ID (e.g., "kc" -> "kilocode") BEFORE taking the lock
  // so the shard key is stable regardless of alias spelling.
  const providerId = resolveProviderId(provider);
  // Acquire per-provider mutex to prevent race conditions within one provider
  const { current: currentMutex, release: resolveMutex } = acquireSelectionMutex(providerId);

  try {
    await currentMutex;

    // Inject a virtual connection for no-auth free providers (with optional proxy pool from settings)
    if (FREE_PROVIDERS[providerId]?.noAuth) {
      const settings = await getSettings();
      const override = (settings.providerStrategies || {})[providerId] || {};
      const strategy = override.rotateStrategy || "none";
      let pickedId = override.proxyPoolId || null;
      if (strategy !== "none") {
        const allPools = await getProxyPools({ isActive: true });
        const poolIds = allPools.filter(p => p.proxyUrl).map(p => p.id);
        pickedId = pickProxyPoolId(poolIds, strategy, providerId);
      }
      const resolvedProxy = await resolveConnectionProxyConfig({ proxyPoolId: pickedId || "" });
      return {
        id: "noauth",
        connectionName: "Public",
        isActive: true,
        accessToken: "public",
        providerSpecificData: {
          connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
          connectionProxyUrl: resolvedProxy.connectionProxyUrl,
          connectionNoProxy: resolvedProxy.connectionNoProxy,
          connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
          vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
        },
      };
    }

    const connections = await getProviderConnections({ provider: providerId, isActive: true });
    log.debug("AUTH", `${provider} | total connections: ${connections.length}, excludeIds: ${excludeSet.size > 0 ? [...excludeSet].join(",") : "none"}, model: ${model || "any"}`);

    if (connections.length === 0) {
      log.warn("AUTH", `No credentials for ${provider}`);
      return null;
    }

    // Antigravity quota cache is lazy: only populated after that account returns 409/429.
    const isAntigravity = providerId === "antigravity";
    const antigravityQuotaCache = isAntigravity && model ? getAntigravityQuotaCache() : null;

    // Filter out model-locked, excluded, and Antigravity quota-exhausted connections.
    const availableConnections = connections.filter(c => {
      if (excludeSet.has(c.id)) return false;
      if (isModelLockActive(c, model)) return false;
      // Antigravity: skip if live quota exhausted for this model
      if (isAntigravity && model && antigravityQuotaCache) {
        const quota = antigravityQuotaCache.get(c.id)?.[model];
        if (quota && quota.remainingPercentage <= 0 && quota.resetAt && new Date(quota.resetAt).getTime() > Date.now()) {
          const account = c.id?.slice(0, 8) || "unknown";
          log.info("AG_QUOTA", `${account} | CACHE_BLOCK ${model} — skip upstream until ${quota.resetAt}`);
          return false;
        }
      }
      return true;
    });

    log.debug("AUTH", `${provider} | available: ${availableConnections.length}/${connections.length}`);
    connections.forEach(c => {
      const excluded = excludeSet.has(c.id);
      const locked = isModelLockActive(c, model);
      if (excluded || locked) {
        const lockUntil = getEarliestModelLockUntil(c);
        log.debug("AUTH", `  → ${c.id?.slice(0, 8)} | ${excluded ? "excluded" : ""} ${locked ? `modelLocked(${model}) until ${lockUntil}` : ""}`);
      }
    });

    if (availableConnections.length === 0) {
      // Find earliest persistent lock or lazy Antigravity quota-cache reset for retry timing.
      const lockedConns = connections.filter(c => isModelLockActive(c, model));
      const expiries = lockedConns.map(c => getEarliestModelLockUntil(c)).filter(Boolean);
      if (isAntigravity && model && antigravityQuotaCache) {
        connections.forEach((c) => {
          const resetAt = antigravityQuotaCache.get(c.id)?.[model]?.resetAt;
          if (resetAt && new Date(resetAt).getTime() > Date.now()) expiries.push(resetAt);
        });
      }
      const earliest = expiries.sort()[0] || null;
      if (earliest) {
        const earliestConn = lockedConns[0];
        log.warn("AUTH", `${provider} | all ${connections.length} accounts locked for ${model || "all"} (${formatRetryAfter(earliest)}) | lastError=${earliestConn?.lastError?.slice(0, 50)}`);
        return {
          allRateLimited: true,
          retryAfter: earliest,
          retryAfterHuman: formatRetryAfter(earliest),
          lastError: earliestConn?.lastError || null,
          lastErrorCode: earliestConn?.errorCode || null
        };
      }
      log.warn("AUTH", `${provider} | all ${connections.length} accounts unavailable`);
      return null;
    }

    const settings = await getSettings();
    ensureSessionSweeper(settings);
    // Per-provider strategy overrides global setting
    const providerOverride = (settings.providerStrategies || {})[providerId] || {};
    // New scheduling mode wins over the legacy fallbackStrategy when explicitly set
    // to something other than the legacy values.
    const legacyStrategy = providerOverride.fallbackStrategy || settings.fallbackStrategy || "fill-first";
    const schedulingMode = providerOverride.schedulingMode
      || settings.schedulingMode
      || legacyStrategy;
    const strategy = schedulingMode === "quota-weighted" ? "quota-weighted" : legacyStrategy;

    // ---- Concurrency gate + session affinity candidate pruning ----
    // Default OFF — must match DEFAULT_SETTINGS.sessionBindingEnabled in settingsRepo.js.
    // A `?? true` here would re-enable affinity for installs whose stored settings
    // predate the flag, defeating the opt-in default.
    const sessionBindingEnabled = providerOverride.sessionBindingEnabled ?? settings.sessionBindingEnabled ?? false;
    const maxSessions = providerOverride.maxSessionsPerAccount ?? settings.maxSessionsPerAccount ?? 0;
    const overflowPolicy = providerOverride.sessionOverflowPolicy || settings.sessionOverflowPolicy || "soft";
    const maxConcurrent = providerOverride.maxConcurrentPerAccount
      ?? settings.maxConcurrentPerAccount
      ?? DEFAULT_MAX_CONCURRENT_PER_ACCOUNT;

    let candidates = availableConnections;
    let boundConnectionId = null;
    // The account this session is pinned to, when it is still in the candidate set.
    // It is kept as a PREFERENCE rather than collapsing `candidates` to a single
    // element: collapsing made a busy bound account unrescuable (the concurrency
    // walk below had no alternative to fall back to, so the session returned 503
    // even while every other account was idle).
    let boundConnection = null;

    if (sessionBindingEnabled && sessionId) {
      boundConnectionId = getBoundConnection(providerId, sessionId);
      if (boundConnectionId) {
        boundConnection = candidates.find((c) => c.id === boundConnectionId) || null;
        if (boundConnection) {
          // Soft preference: the bound account is tried FIRST (it is what preserves
          // the provider-side prompt cache) but the full candidate set is retained so
          // the concurrency gate can still fail over when it is saturated.
          const rest = candidates.filter((c) => c.id !== boundConnectionId);
          candidates = [boundConnection, ...rest];
          log.debug("AUTH", `${provider} | session ${String(sessionId).slice(0, 8)} → prefer bound ${boundConnectionId.slice(0, 8)}`);
        } else {
          // Bound account became unavailable/excluded → drop the stale binding and
          // re-select. bindSession() later will move the session.
          log.info("AUTH", `${provider} | session ${String(sessionId).slice(0, 8)} bound account ${boundConnectionId.slice(0, 8)} unavailable → rebind`);
        }
      }
    }

    // ---- New-session capacity shaping (all scheduling modes) ----
    // A session without a binding must consume the WHOLE enabled pool before any
    // account is pushed past maxSessionsPerAccount: the cap is a limit on how many
    // distinct conversations an account absorbs, so an account already at its cap
    // must not be chosen while accounts below it still have room.
    //
    // Rather than intercepting each mode's pick afterwards (which would also strand
    // round-robin's lastUsedAt write on the wrong account), the full candidates are
    // reordered so under-cap accounts come first. Every mode downstream then naturally
    // prefers them, and a cap-full account only gets selected when nothing else is
    // left — which is exactly when the soft/hard overflow policy should apply. The
    // bound account is exempt because reusing it cannot grow its session count.
    if (sessionBindingEnabled && sessionId && !boundConnection && maxSessions > 0) {
      const underCap = [];
      const atCap = [];
      for (const c of candidates) {
        if (getSessionCount(c.id) < maxSessions) underCap.push(c);
        else atCap.push(c);
      }
      // Least-loaded first WITHIN each group is what spreads the pool, but priority
      // must still win so an operator's ordering is respected:
      //   under-cap: priority ASC, then load ASC, then id (stable, deterministic)
      //   at-cap:    load ASC (this feeds the soft-overflow pick), then priority ASC
      const byPriority = (a, b) =>
        (Number(a.priority) || 0) - (Number(b.priority) || 0) ||
        String(a.id).localeCompare(String(b.id));
      underCap.sort(
        (a, b) => getSessionCount(a.id) - getSessionCount(b.id) || byPriority(a, b)
      );
      atCap.sort(
        (a, b) => getSessionCount(a.id) - getSessionCount(b.id) || byPriority(a, b)
      );
      if (atCap.length) {
        log.debug(
          "AUTH",
          `${provider} | new session ${String(sessionId).slice(0, 8)}: ${underCap.length} account(s) under cap, ${atCap.length} at cap (pool full) → under-cap first`
        );
      }
      // Under-cap accounts always come first so the whole pool is consumed before the
      // cap is exceeded; the overflow policy below only fires if `underCap` is empty.
      candidates = [...underCap, ...atCap];
    }

    let connection;
    // Pin to preferred connection if specified and available.
    // Precedence (audit item #10): an explicit hard pin (preferredConnectionId) is a
    // caller instruction and outranks session affinity; session binding only applies
    // when no hard pin was requested.
    if (preferredConnectionId) {
      connection = candidates.find((c) => c.id === preferredConnectionId)
        || availableConnections.find((c) => c.id === preferredConnectionId);
      if (connection) {
        log.info("AUTH", `${provider} | pinned to ${connection.id?.slice(0, 8)} (${connection.name || connection.email || "unnamed"})`);
      }
    }

    // ---- Session affinity short-circuit (applies to ALL scheduling modes) ----
    // The bound account is only moved to the FRONT of `candidates` above, which is
    // enough for fill-first but is silently discarded by round-robin (sorts by
    // lastUsedAt) and quota-weighted (sorts by score). Since the UI lets affinity be
    // combined with any mode, honour it here: if the session already has a healthy
    // bound account, reuse it regardless of mode. That is the entire point of
    // affinity — keeping the upstream prompt cache warm.
    //
    // The concurrency gate below can still fail over to another candidate if this
    // account turns out to be saturated, so this is a preference, not a pin.
    //
    // Session-cap interaction: reusing the bound account does NOT grow its session
    // count (getBoundConnection() only returns an account that already holds this
    // session), so a bound account at its cap should NOT be treated as full for THIS
    // session — evicting it here would rebind an established conversation to a cold
    // account on every request, destroying the prompt cache affinity exists to keep.
    //
    // What must not happen is an account that is at cap ABSORBING additional sessions.
    // That is enforced where new bindings are chosen (the fill-first branch below and
    // bindSession's cap accounting), not here.
    if (!connection && sessionBindingEnabled && sessionId && boundConnection) {
      connection = boundConnection;
      log.debug("AUTH", `${provider} | session affinity honoured in mode=${strategy} → ${boundConnection.id.slice(0, 8)}`);
    }

    if (!connection && strategy === "quota-weighted") {
      const { connection: picked, score, detail } = pickQuotaWeighted(candidates, {
        // Apply the short-lived optimistic discount so concurrent selectors within
        // the decay window do not all converge on the same "best" account against a
        // stale snapshot (audit item #6, snapshot lag stampede).
        getQuota: withOptimisticDiscount((c) => resolveAccountQuota(c, providerId, model)),
        weightRemaining: providerOverride.quotaWeightRemaining ?? settings.quotaWeightRemaining ?? 1.0,
        weightExpiry: providerOverride.quotaWeightExpiry ?? settings.quotaWeightExpiry ?? 0.5,
        preferEarlierExpiry: providerOverride.quotaPreferEarlierExpiry ?? settings.quotaPreferEarlierExpiry ?? true,
      });
      connection = picked;
      if (connection && detail) {
        const scoreText = Number.isFinite(score) ? score.toFixed(3) : "n/a";
        log.debug("AUTH", `${provider} | quota-weighted pick ${connection.id?.slice(0, 8)} score=${scoreText} remaining=${detail.remaining ?? "n/a"} msToExpiry=${detail.msUntilExpiry ?? "n/a"}`);
      }
    }

    if (connection) {
      // skip strategy (pinned or quota-weighted already chose)
    } else if (strategy === "round-robin") {
      const stickyLimit = providerOverride.stickyRoundRobinLimit || settings.stickyRoundRobinLimit || 3;

      // Sort by lastUsed (most recent first) to find current candidate
      const byRecency = [...candidates].sort((a, b) => {
        if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
        if (!a.lastUsedAt) return 1;
        if (!b.lastUsedAt) return -1;
        return new Date(b.lastUsedAt) - new Date(a.lastUsedAt);
      });

      const current = byRecency[0];
      const currentCount = current?.consecutiveUseCount || 0;

      if (current && current.lastUsedAt && currentCount < stickyLimit) {
        // Stay with current account
        connection = current;
        // Update lastUsedAt and increment count (await to ensure persistence)
        await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: (connection.consecutiveUseCount || 0) + 1
        });
      } else {
        // Pick the least recently used (excluding current if possible)
        const sortedByOldest = [...candidates].sort((a, b) => {
          if (!a.lastUsedAt && !b.lastUsedAt) return (a.priority || 999) - (b.priority || 999);
          if (!a.lastUsedAt) return -1;
          if (!b.lastUsedAt) return 1;
          return new Date(a.lastUsedAt) - new Date(b.lastUsedAt);
        });

        connection = sortedByOldest[0];

        // Update lastUsedAt and reset count to 1 (await to ensure persistence)
        await updateProviderConnection(connection.id, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: 1
        });
      }
    } else {
      // Default: fill-first.
      //
      // Fill-first must not mean "always take candidates[0]". When many accounts
      // share the same priority (the common case — every row left at its default),
      // that collapses all traffic onto the first account while the rest of the pool
      // sits idle. Each account then burns through its upstream rate limit and starts
      // returning 429 while hundreds of healthy accounts are never touched.
      //
      // Instead, order by (load ASC, priority ASC) and take the head. Load must come
      // FIRST, not priority: ordering by priority ahead of load would again funnel
      // everything into the single highest-priority account whenever an operator has
      // actually set per-account priorities, which is the same starvation this branch
      // exists to prevent. Priority is the tiebreak, so an operator's ordering still
      // decides between accounts that are equally idle. An account with no sessions
      // therefore always outranks one that already holds sessions, and the pool fills
      // up in parallel. Accounts that were excluded or model-locked are already absent
      // from `candidates`.
      //
      // `load` is the bound-session count when affinity is active, otherwise the
      // in-flight request count, so the same spreading applies with affinity off.
      const useSessionLoad = sessionBindingEnabled && sessionId && maxSessions > 0;
      const loadOf = (c) => (useSessionLoad ? getSessionCount(c.id) : getLoad(c.id));

      const ranked = [...candidates].sort((a, b) => {
        const lDiff = loadOf(a) - loadOf(b);
        if (lDiff !== 0) return lDiff;
        const pDiff = (Number(a.priority) || 0) - (Number(b.priority) || 0);
        if (pDiff !== 0) return pDiff;
        // Deterministic tiebreak so equal accounts do not thrash between requests.
        return String(a.id).localeCompare(String(b.id));
      });

      // Take the least-loaded account. The candidate list was already reordered so
      // under-cap accounts come first, so this naturally avoids an account that is at
      // its session cap while the pool still has room; the overflow policy below only
      // fires once every candidate is genuinely full.
      connection = ranked[0];
    }

    // ---- Overflow policy: every candidate is at its session cap ----
    // The candidate ordering above guarantees a cap-full account is only reached once
    // no under-cap account remains, so this is the genuine "pool is full" case: soft
    // deliberately exceeds on the least-loaded account, hard refuses.
    if (
      connection &&
      !boundConnection &&
      sessionBindingEnabled &&
      sessionId &&
      maxSessions > 0 &&
      getSessionCount(connection.id) >= maxSessions
    ) {
      if (overflowPolicy === "hard") {
        connection = null;
      } else {
        log.warn(
          "AUTH",
          `${provider} | all ${candidates.length} accounts at session cap ${maxSessions} (soft overflow) → ${connection.id.slice(0, 8)} now holds ${getSessionCount(connection.id) + 1}`
        );
      }
    }

    // ---- HARD failure: no account could satisfy the (hard-cap) constraints ----
    if (!connection) {
      log.warn("AUTH", `${provider} | no account within session/overflow constraints (mode=${strategy}, cap=${maxSessions}, policy=${overflowPolicy})`);
      return {
        allRateLimited: true,
        retryAfter: null,
        retryAfterHuman: "session capacity",
        lastError: `all accounts at maxSessionsPerAccount=${maxSessions}`,
        lastErrorCode: "SESSION_CAPACITY",
        sessionCapacityExceeded: true,
      };
    }

    // ---- Concurrency gate (audit items #2 & #7) ----
    // Reserved INSIDE the per-provider mutex via a SYNCHRONOUS acquire so two
    // concurrent selectors cannot both observe "count < max" and both succeed
    // (the original TOCTOU). If the chosen account is full, walk to the next
    // candidate that still has a free slot.
    let slotAcquired = false;
    if (reserveSlot && connection.id && connection.id !== "noauth") {
      let gate = acquireAccountSlot(connection.id, maxConcurrent);
      if (!gate.ok) {
        log.debug("AUTH", `${provider} | ${connection.id.slice(0, 8)} at concurrency ceiling ${maxConcurrent} → try next candidate`);
        // Walk candidates LAZILY and stop at the first one that reserves a slot.
        // Using .map() here would acquire a slot on EVERY candidate (map is eager)
        // while .find() then keeps only one of them, leaking a count on all the
        // others — and they are never released because only the returned account's
        // slot is tracked by the caller.
        let alt = null;
        for (const c of candidates) {
          if (c.id === connection.id) continue;
          const ok = acquireAccountSlot(c.id, maxConcurrent);
          if (ok.ok) {
            alt = { c, ok };
            break;
          }
        }
        if (alt) {
          connection = alt.c;
          gate = alt.ok;
          slotAcquired = true;
        } else {
          // Every candidate is saturated right now: this is a concurrency
          // contention condition, NOT quota exhaustion. Surface it as retryable
          // so the caller can back off briefly instead of locking accounts.
          log.warn("AUTH", `${provider} | all ${candidates.length} accounts at concurrency ceiling ${maxConcurrent}`);
          return {
            allRateLimited: true,
            retryAfter: null,
            retryAfterHuman: "concurrency",
            lastError: `all accounts at maxConcurrentPerAccount=${maxConcurrent}`,
            lastErrorCode: "CONCURRENCY_LIMITED",
            concurrencyLimited: true,
          };
        }
      } else {
        slotAcquired = true;
      }
    }

    // Optimistic consumption: discount this account's apparent remaining quota for
    // the next few seconds so a concurrent burst spreads instead of converging.
    // Only meaningful for quota-weighted scoring — the discount is read exclusively
    // by withOptimisticDiscount(), so recording it in other modes would just grow
    // an unused map.
    let discountApplied = false;
    if (strategy === "quota-weighted" && connection.id && connection.id !== "noauth") {
      recordConsumption(connection.id, 1);
      discountApplied = true;
    }

    // ---- Record / refresh the session binding ----
    // Only when the caller actually got a slot (or the account is virtual) so a
    // failed selection never creates a binding that was never used.
    if (sessionBindingEnabled && sessionId && connection.id && connection.id !== "noauth" && (slotAcquired || !reserveSlot)) {
      const { moved } = bindSession(providerId, sessionId, connection.id);
      if (moved) {
        log.info("AUTH", `${provider} | session ${String(sessionId).slice(0, 8)} rebound → ${connection.id.slice(0, 8)}`);
      }
    }

    // Anything that can throw AFTER a slot was reserved must release it, otherwise
    // the credentials object never reaches the caller and its finally-block can never
    // call releaseAccountSlot() — the count would leak permanently and the account
    // would look saturated forever, cascading into bogus CONCURRENCY_LIMITED errors.
    // The optimistic discount is rolled back for the same reason: no request was
    // ever issued, so nothing was consumed.
    let resolvedProxy;
    try {
      resolvedProxy = await resolveConnectionProxyConfig(connection.providerSpecificData || {});
    } catch (err) {
      if (slotAcquired) releaseAccountSlotInternal(connection.id);
      if (discountApplied) releaseConsumption(connection.id, 1);
      throw err;
    }

    return {
      authType: connection.authType,
      apiKey: connection.apiKey,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      idToken: connection.idToken,
      expiresAt: connection.expiresAt,
      expiresIn: connection.expiresIn,
      lastRefreshAt: connection.lastRefreshAt,
      projectId: connection.projectId,
      connectionName: connection.displayName || connection.name || connection.email || connection.id,
      copilotToken: connection.providerSpecificData?.copilotToken,
      providerSpecificData: {
        ...(connection.providerSpecificData || {}),
        connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
        connectionProxyUrl: resolvedProxy.connectionProxyUrl,
        connectionNoProxy: resolvedProxy.connectionNoProxy,
        connectionProxyPoolId: resolvedProxy.proxyPoolId || null,
        vercelRelayUrl: resolvedProxy.vercelRelayUrl || "",
      },
      connectionId: connection.id,
      // Include current status for optimization check
      testStatus: connection.testStatus,
      lastError: connection.lastError,
      // True when this selection reserved an in-flight concurrency slot that the
      // caller MUST release (in a finally block) via releaseAccountSlot().
      slotReserved: slotAcquired,
      // True when a short-lived optimistic quota discount was applied for this
      // selection. Callers that abandon the attempt without consuming quota should
      // refund it via refundAccountQuotaDiscount().
      quotaDiscountApplied: discountApplied,
      // Pass full connection for clearAccountError to read modelLock_* keys
      _connection: connection
    };
  } finally {
    if (resolveMutex) resolveMutex();
  }
}

/**
 * Mark account+model as unavailable — locks modelLock_${model} in DB.
 * All errors (429, 401, 5xx, etc.) lock per model, not per account.
 * @param {string} connectionId
 * @param {number} status - HTTP status code from upstream
 * @param {string} errorText
 * @param {string|null} provider
 * @param {string|null} model - The specific model that triggered the error
 * @returns {{ shouldFallback: boolean, cooldownMs: number }}
 */
export async function markAccountUnavailable(connectionId, status, errorText, provider = null, model = null, resetsAtMs = null) {
  if (!connectionId || connectionId === "noauth") return { shouldFallback: false, cooldownMs: 0 };

  // A 429 caused by per-account CONCURRENCY limits must be short-circuited before
  // anything else. It is a contention signal, not quota exhaustion: the account is
  // still perfectly usable once an in-flight request drains.
  //
  // This check must come before the githubResetAtMs / resetsAtMs branches, not after.
  // Providers commonly attach `Retry-After` to concurrency rejections too, which
  // makes `resetsAtMs` truthy — so a check placed in the trailing `else` would
  // never be reached for exactly the traffic it was written for, and the account
  // would be locked for the full retry window.
  //
  // Returning early also guarantees we perform NO DB write here, which keeps this
  // function side-effect free on the concurrency path (callers may probe it before
  // deciding whether to retry).
  if (isConcurrencyLimited(status, errorText)) {
    return { shouldFallback: false, cooldownMs: 0, concurrencyLimited: true };
  }

  const connections = await getProviderConnections({ provider });
  const conn = connections.find(c => c.id === connectionId);
  const backoffLevel = conn?.backoffLevel || 0;

  // GitHub premium-request exhaustion is account-wide until the next UTC month.
  const githubResetAtMs = githubMonthlyResetMs(status, errorText, provider);

  // Provider-specific precise cooldown (e.g. codex usage_limit_reached resets_at) overrides backoff
  let shouldFallback, cooldownMs, newBackoffLevel;
  if (githubResetAtMs) {
    shouldFallback = true;
    cooldownMs = githubResetAtMs - Date.now();
    newBackoffLevel = 0;
  } else if (resetsAtMs && resetsAtMs > Date.now()) {
    shouldFallback = true;
    // Antigravity quota API provides exact per-model resetAt. Do not truncate it.
    cooldownMs = resolveProviderId(provider) === "antigravity"
      ? resetsAtMs - Date.now()
      : Math.min(resetsAtMs - Date.now(), MAX_RATE_LIMIT_COOLDOWN_MS);
    newBackoffLevel = 0;
  } else {
    ({ shouldFallback, cooldownMs, newBackoffLevel } = checkFallbackError(status, errorText, backoffLevel));
  }
  if (!shouldFallback) return { shouldFallback: false, cooldownMs: 0 };

  const reason = typeof errorText === "string" ? errorText.slice(0, 100) : "Provider error";
  const lockUpdate = buildModelLockUpdate(githubResetAtMs ? null : model, cooldownMs);

  await updateProviderConnection(connectionId, {
    ...lockUpdate,
    testStatus: "unavailable",
    lastError: reason,
    errorCode: status,
    lastErrorAt: new Date().toISOString(),
    backoffLevel: newBackoffLevel ?? backoffLevel
  });

  const lockKey = Object.keys(lockUpdate)[0];
  const connName = conn?.displayName || conn?.name || conn?.email || connectionId.slice(0, 8);
  log.warn("AUTH", `${connName} locked ${lockKey} for ${Math.round(cooldownMs / 1000)}s [${status}]`);

  if (provider && status && reason) {
    console.error(`❌ ${provider} [${status}]: ${reason}`);
  }

  return { shouldFallback: true, cooldownMs };
}

/**
 * Clear account error status on successful request.
 * - Clears modelLock_${model} (the model that just succeeded)
 * - Lazy-cleans any other expired modelLock_* keys
 * - Resets error state only if no active locks remain
 * @param {string} connectionId
 * @param {object} currentConnection - credentials object (has _connection) or raw connection
 * @param {string|null} model - model that succeeded
 */
export async function clearAccountError(connectionId, currentConnection, model = null) {
  if (!connectionId || connectionId === "noauth") return;
  const conn = currentConnection._connection || currentConnection;
  const now = Date.now();
  const allLockKeys = Object.keys(conn).filter(k => k.startsWith("modelLock_"));

  if (!conn.testStatus && !conn.lastError && allLockKeys.length === 0) return;

  // Keys to clear: current model's lock + all expired locks
  const keysToClear = allLockKeys.filter(k => {
    if (model && k === `modelLock_${model}`) return true; // succeeded model
    if (model && k === "modelLock___all") return true;    // account-level lock
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() <= now;   // expired
  });

  if (keysToClear.length === 0 && conn.testStatus !== "unavailable" && !conn.lastError) return;

  // Check if any active locks remain after clearing
  const remainingActiveLocks = allLockKeys.filter(k => {
    if (keysToClear.includes(k)) return false;
    const expiry = conn[k];
    return expiry && new Date(expiry).getTime() > now;
  });

  const clearObj = Object.fromEntries(keysToClear.map(k => [k, null]));

  // Only reset error state if no active locks remain
  if (remainingActiveLocks.length === 0) {
    Object.assign(clearObj, {
      testStatus: "active",
      lastError: null,
      errorCode: null,
      lastErrorAt: null,
      backoffLevel: 0
    });
  }

  await updateProviderConnection(connectionId, clearObj);
}

/**
 * Release an account concurrency slot previously reserved by getProviderCredentials.
 * Safe to call unconditionally: it is a no-op when the credentials never reserved a
 * slot, and the underlying counter clamps at 0 (idempotent on double release).
 * @param {object|null} credentials - the object returned by getProviderCredentials
 */
export function releaseAccountSlot(credentials) {
  if (!credentials || !credentials.slotReserved) return;
  const connectionId = credentials.connectionId || credentials.id;
  if (!connectionId || connectionId === "noauth") return;
  releaseAccountSlotInternal(connectionId);
  credentials.slotReserved = false;
}

/**
 * Refund the optimistic quota discount applied when these credentials were
 * selected.
 *
 * Call this when the attempt is abandoned WITHOUT consuming upstream quota — a
 * concurrency-429 retry or a failover to a different account. Leaving the
 * discount in place would make a healthy account look emptier than it is for the
 * rest of the 30s decay window and steer later selections away from it.
 *
 * Do NOT call it after a request that actually reached the provider: that one did
 * consume quota, and the discount is exactly the signal we want to keep.
 *
 * Safe to call unconditionally — it is a no-op when no discount was applied, and
 * the flag is cleared so a double call cannot over-refund.
 *
 * @param {object|null} credentials - the object returned by getProviderCredentials
 */
export function refundAccountQuotaDiscount(credentials) {
  if (!credentials || !credentials.quotaDiscountApplied) return;
  const connectionId = credentials.connectionId || credentials.id;
  if (!connectionId || connectionId === "noauth") return;
  releaseConsumption(connectionId, 1);
  credentials.quotaDiscountApplied = false;
}

/**
 * Extract API key from request headers
 */
export function extractApiKey(request) {
  // Check Authorization header first
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  // Check Anthropic x-api-key header
  const xApiKey = request.headers.get("x-api-key");
  if (xApiKey) {
    return xApiKey;
  }

  return null;
}

/**
 * Validate API key (optional - for local use can skip)
 */
export async function isValidApiKey(apiKey) {
  if (!apiKey) return false;
  return await validateApiKey(apiKey);
}
