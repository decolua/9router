"use client";

/**
 * CB4 — the ONE fetch for combo success stats. Both the combos cards and the
 * Usage-by-Combo "Success %" column read through this hook so there is a single
 * request path to GET /api/usage/combo-stats (never a second derivation from
 * usage/stats). Fail-open lives in loadComboStats: a dead endpoint yields
 * `{ data: null, error: true }`, the chip degrades to "—", and no toast fires.
 *
 * Poll cadence (30s) matches ProviderHealthBadge — the read is cheap and the
 * surface stays live without the user reopening anything.
 */
import { useState, useEffect, useCallback } from "react";
import { loadComboStats } from "./comboStats.js";

const POLL_MS = 30_000;

export function useComboStats(range = "24h") {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);

  const refresh = useCallback(() => {
    let cancelled = false;
    loadComboStats(range).then((res) => {
      if (cancelled) return;
      setData(res.data);
      setError(res.error);
    });
    return () => {
      cancelled = true;
    };
  }, [range]);

  useEffect(() => {
    let alive = true;
    loadComboStats(range).then((res) => {
      if (!alive) return;
      setData(res.data);
      setError(res.error);
    });
    const interval = setInterval(refresh, POLL_MS);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [range, refresh]);

  return { data, error, refresh };
}

export default useComboStats;
