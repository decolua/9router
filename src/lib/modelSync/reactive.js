// T3.2/RB — reactive model catalog sync on upstream `model_not_found`.
// Port of OmniRoute providerModels/reactiveModelSync.ts, scoped to one hook:
// chatCore's upstream-error branch (open-sse/handlers/chatCore.js) when the
// effective status is 404 (open-sse/config/errorConfig.js maps 404 →
// { type: "invalid_request_error", code: "model_not_found" }).
//
// Why: an account's model list can drift from our cached catalog (provider
// renames/deprecates a model, plan changes add one). When an upstream call
// 404s for ONE connection, a fresh /models fetch is the cheapest way to
// converge the catalog before the daily scheduler sync (docs/MODEL_SYNC_CATALOG.md)
// gets there. The trigger is fire-and-forget: the failing request itself is
// NEVER re-run or delayed — the existing combo/account fallback and the 2-sync
// "missing" lifecycle (connectionCatalog RETRY_AFTER_MISSING) do the rest.
//
// Concurrency/cost model for a burst of 404s on one connection:
//   1. LOCAL cooldown (this file): one kickoff per connection per
//      REACTIVE_SYNC_COOLDOWN_MS. F4's cooldownMs ledger deliberately only
//      serves the MANUAL path (syncConnectionCatalog applies cooldownMs to
//      !automatic calls), so the automatic trigger keeps its own clock.
//   2. F4 single-flight (connectionCatalog inFlightSyncs): calls that pass the
//      cooldown while a sync is still running join the SAME in-flight promise
//      (one fetch), and pass { automatic: true } so the CONNECTION_MODEL_SYNC=off
//      kill switch is enforced at the chokepoint, exactly like the scheduler.
// A kickoff marks the clock even if the sync later fails: failures only log
// here; connectionCatalog records lastError on the row and the 24h cycle is
// the backstop.

import REGISTRY from "open-sse/providers/registry/index.js";
import {
  SYNCABLE_MODELS_FETCHER_TYPES,
  isAutomaticModelSyncEnabled,
  syncConnectionCatalog,
} from "./connectionCatalog.js";

export const REACTIVE_SYNC_COOLDOWN_MS = 10 * 60 * 1000;

// connectionId -> ms timestamp of the last kickoff (not of the last attempt
// that got suppressed — see header). Connections are few; clear-the-ledger at
// 500 mirrors F4's lastManualSync bound.
const lastTriggerAt = new Map();

/**
 * Same predicate F4's resolveModelsUrl uses for registry-driven fetchers:
 * only modelsFetcher shapes listed in SYNCABLE_MODELS_FETCHER_TYPES return an
 * OpenAI-shaped list we can sync per account. Exact `entry.id` match, like
 * connectionCatalog. Runs without touching the DB so the request path only
 * pays a synchronous registry scan.
 */
export function isReactiveSyncableProvider(provider) {
  if (typeof provider !== "string" || !provider) return false;
  const entry = REGISTRY.find((e) => e.id === provider);
  return SYNCABLE_MODELS_FETCHER_TYPES.has(entry?.modelsFetcher?.type);
}

/** Drop one connection's cooldown entry (tests; also useful after a user
 *  syncs manually from the dashboard and a 404 should be able to react again). */
export function clearReactiveSyncCooldown(connectionId) {
  if (connectionId === undefined) lastTriggerAt.clear();
  else lastTriggerAt.delete(connectionId);
}

/**
 * Fire-and-forget kickoff. NEVER awaits anything, NEVER throws into the
 * caller, and never re-runs the failed request. Returns the background
 * promise (for tests/telemetry) or null when suppressed.
 *
 * @param {{ connectionId?: string, provider?: string, model?: string }} ctx
 * @param {object} [deps] test seams:
 *   `sync` (defaults to the F4 chokepoint), `isSyncable`, `cooldownMs`,
 *   `now`, `log` ({ warn(tag, msg) } like the app logger).
 */
export function triggerReactiveModelSync({ connectionId, provider, model } = {}, deps = {}) {
  const {
    sync = syncConnectionCatalog,
    isSyncable = isReactiveSyncableProvider,
    cooldownMs = REACTIVE_SYNC_COOLDOWN_MS,
    now = Date.now,
    log,
  } = deps;
  try {
    if (!connectionId || !provider) return null;
    // Kill switch: same predicate F4 enforces for { automatic: true } callers.
    // Checked here too so a disabled install never burns the cooldown slot or
    // a DB read on something the chokepoint would drop anyway.
    if (!isAutomaticModelSyncEnabled()) return null;
    if (!isSyncable(provider)) return null;

    const at = now();
    const last = lastTriggerAt.get(connectionId);
    if (typeof last === "number" && at - last < cooldownMs) return null;
    if (lastTriggerAt.size > 500) lastTriggerAt.clear();
    lastTriggerAt.set(connectionId, at);

    // Promise.resolve() wrapping: even a synchronous throw inside `sync`
    // stays on the background promise and can never surface at the call site.
    return Promise.resolve()
      .then(() => sync(connectionId, { automatic: true }))
      .then((result) => {
        if (result && result.error) {
          log?.warn?.("MODELSYNC", `reactive sync failed (${provider}/${model} · ${connectionId}): ${result.error}`);
        }
        return result;
      })
      .catch((error) => {
        log?.warn?.("MODELSYNC", `reactive sync threw (${provider}/${model} · ${connectionId}): ${error?.message || error}`);
        return null;
      });
  } catch (error) {
    // Defensive: trigger errors must never reach the request path.
    log?.warn?.("MODELSYNC", `reactive sync trigger failed: ${error?.message || error}`);
    return null;
  }
}
