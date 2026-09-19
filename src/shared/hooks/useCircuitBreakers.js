"use client";

import { useState, useEffect, useCallback } from "react";

const POLL_MS = 5000;

/**
 * Real breaker keys are `provider:connectionId:model` (buildAccountBreakerName
 * in open-sse/utils/circuitBreaker.js). That module is server-side and must not
 * be pulled into the client bundle, so the account-matching convention it (and
 * the F24c reset route) uses is mirrored here instead of imported.
 */
const STATE_SEVERITY = { CLOSED: 0, DEGRADED: 1, HALF_OPEN: 2, OPEN: 3 };

function anyBreakerNotClosed(breakers) {
  return breakers.some((b) => b.state && b.state !== "CLOSED");
}

function accountBreakerKey(providerId, connectionId) {
  return `${String(providerId)}:${String(connectionId)}`;
}

/**
 * Segment-boundary match, identical in spirit to resetCircuitBreakersByPrefix:
 * a key belongs to the account when it IS the account key or continues it on a
 * `:` boundary. Plain startsWith would let `p:conn-1` also claim `p:conn-10`.
 */
export function breakerNameBelongsToAccount(name, providerId, connectionId) {
  if (typeof name !== "string" || !name) return false;
  const account = accountBreakerKey(providerId, connectionId);
  return name === account || name.startsWith(`${account}:`);
}

// Unknown non-CLOSED states rank as DEGRADED, mirroring CircuitBreakerBadge's
// own display fallback; CLOSED is explicitly zero.
function severityOf(state) {
  if (!state || state === "CLOSED") return 0;
  return STATE_SEVERITY[state] ?? 1;
}

/**
 * Aggregate every breaker of one connection into the single status the badge
 * shows: the WORST state across them (OPEN > HALF_OPEN > DEGRADED > CLOSED).
 *
 * Before this, the badge looked up `provider:connectionId` exactly and real
 * keys always carry a model segment, so nothing ever matched and the badge —
 * gate to the reset button — never rendered.
 *
 * retryAfterMs / failureCount / models describe the worst-state set only, so
 * the badge shows the longest remaining block among the tripped models and the
 * tooltip can name which ones tripped. `name` is the ACCOUNT key because the
 * panel resets by it and the F24c route sweeps per-model keys underneath.
 *
 * @returns {{name: string, state: string, retryAfterMs: number,
 *   failureCount: number, models: string[]}|null} null when the connection has
 *   no breakers at all (same "no badge" outcome as before).
 */
export function aggregateCircuitBreakersForConnection(breakers, providerId, connectionId) {
  if (!Array.isArray(breakers)) return null;
  const account = accountBreakerKey(providerId, connectionId);
  const mine = breakers.filter((b) => b && breakerNameBelongsToAccount(b.name, providerId, connectionId));
  if (mine.length === 0) return null;

  let worst = null;
  for (const b of mine) {
    if (!worst || severityOf(b.state) > severityOf(worst.state)) worst = b;
  }
  const worstSeverity = severityOf(worst.state);
  const worstSet = mine.filter((b) => severityOf(b.state) === worstSeverity);
  const num = (v) => (Number.isFinite(v) ? v : 0);

  return {
    name: account,
    state: worst.state,
    retryAfterMs: worstSet.reduce((max, b) => Math.max(max, num(b.retryAfterMs)), 0),
    failureCount: worstSet.reduce((sum, b) => sum + num(b.failureCount), 0),
    models:
      worstSeverity > 0
        ? worstSet
            .map((b) => (b.name.length > account.length ? b.name.slice(account.length + 1) : null))
            .filter(Boolean)
        : [],
  };
}

async function loadCircuitBreakers() {
  const res = await fetch("/api/providers/circuit-breakers");
  if (!res.ok) throw new Error(`circuit-breakers GET ${res.status}`);
  const data = await res.json();
  return Array.isArray(data.breakers) ? data.breakers : [];
}

/**
 * Fetch and manage per-account circuit breaker statuses.
 * Polls GET every 5s only while any breaker is not CLOSED.
 */
export function useCircuitBreakers() {
  const [breakers, setBreakers] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchStatuses = useCallback(async () => {
    try {
      const list = await loadCircuitBreakers();
      setBreakers(list);
      return list;
    } catch (error) {
      console.error("Failed to fetch circuit breakers:", error);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadCircuitBreakers()
      .then((list) => {
        if (!cancelled) {
          setBreakers(list);
          setLoading(false);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error("Failed to fetch circuit breakers:", error);
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const shouldPoll = anyBreakerNotClosed(breakers);

  useEffect(() => {
    if (!shouldPoll) return undefined;
    let cancelled = false;
    const interval = setInterval(() => {
      loadCircuitBreakers()
        .then((list) => {
          if (!cancelled) setBreakers(list);
        })
        .catch((error) => {
          if (!cancelled) console.error("Failed to fetch circuit breakers:", error);
        });
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [shouldPoll]);

  const getCircuitBreakerForConnection = useCallback(
    (providerId, connectionId) => aggregateCircuitBreakersForConnection(breakers, providerId, connectionId),
    [breakers],
  );

  const getOpenCountForProvider = useCallback((providerId) => {
    const prefix = `${providerId}:`;
    return breakers.filter((s) => s.name.startsWith(prefix) && s.state !== "CLOSED").length;
  }, [breakers]);

  const resetCircuitBreaker = useCallback(async (name) => {
    try {
      const res = await fetch(`/api/providers/circuit-breakers/${encodeURIComponent(name)}/reset`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`reset ${name} → ${res.status}`);
      await fetchStatuses();
      return true;
    } catch (error) {
      console.error("Failed to reset circuit breaker:", error);
      return false;
    }
  }, [fetchStatuses]);

  return {
    breakers,
    loading,
    getCircuitBreakerForConnection,
    getOpenCountForProvider,
    resetCircuitBreaker,
    refresh: fetchStatuses,
  };
}
