"use client";

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import RankingBindRow from "./RankingBindRow";

/**
 * Orders a combo's models by an Artificial Analysis benchmark preset.
 *
 * Models the leaderboard cannot be matched to are appended rather than dropped,
 * and reported explicitly — a combo's model list is its fallback chain, so
 * silently losing a tier would change routing behaviour.
 */
export default function ComboRankingBar({ models, onReorder }) {
  const [status, setStatus] = useState(null);
  const [presets, setPresets] = useState([]);
  const [preset, setPreset] = useState("general");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [unmatched, setUnmatched] = useState([]);
  const [suggestions, setSuggestions] = useState({});
  const [bindings, setBindings] = useState({});
  const [autoBound, setAutoBound] = useState({});

  const fetchStatus = useCallback(async () => {
    const res = await fetch("/api/aa/rankings", { cache: "no-store" });
    if (!res.ok) throw new Error(`rankings ${res.status}`);
    return res.json();
  }, []);

  const applyStatus = useCallback((data) => {
    setStatus(data);
    setPresets(data.presets || []);
    if (data.defaultPreset) setPreset((current) => current || data.defaultPreset);
  }, []);

  useEffect(() => {
    let alive = true;
    fetchStatus()
      .then((data) => { if (alive) applyStatus(data); })
      // Ranking is an optional enhancement; a failed status check just hides it.
      .catch(() => {});
    return () => { alive = false; };
  }, [fetchStatus, applyStatus]);

  const reloadStatus = useCallback(
    () => fetchStatus().then(applyStatus).catch(() => {}),
    [fetchStatus, applyStatus],
  );

  const handleSync = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/aa/rankings", { method: "POST" });
      const data = await res.json();
      const detail = (data.results || [])
        .map((r) => `${r.label || r.id}: ${r.ok ? `${r.count}` : r.error || "failed"}`)
        .join(" · ");
      setMessage(data.ok
        ? { kind: "ok", text: `Synced ${data.count} models. ${detail}` }
        : { kind: "warn", text: data.kept ? `${detail} — kept the previous snapshots.` : detail || data.error });
      await reloadStatus();
    } catch (error) {
      setMessage({ kind: "warn", text: error?.message || "Sync failed" });
    } finally {
      setBusy(false);
    }
  };

  const handleApply = async (overrideBindings = bindings) => {
    if (models.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/aa/rank", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ models, preset, bindings: overrideBindings }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ kind: "warn", text: data.error || "Ranking failed" });
        return;
      }
      onReorder(data.order);
      setUnmatched(data.needsReview || data.unmatched || []);
      setSuggestions(data.suggestions || {});
      setAutoBound(data.autoBound || {});
      // Adopt the server's merged view (remembered + just-chosen) so the
      // dropdowns reflect what is actually stored, not just this session's clicks.
      if (data.remembered) setBindings(data.remembered);
      const autoCount = Object.keys(data.autoBound || {}).length;
      const stillUnmatched = (data.unmatched || []).length;
      const rankedCount = data.order.length - stillUnmatched;
      setMessage({
        kind: "ok",
        text:
          `Ordered ${rankedCount} model${rankedCount === 1 ? "" : "s"} by ${preset}.` +
          (autoCount > 0 ? ` ${autoCount} matched automatically — review below.` : ""),
      });
    } catch (error) {
      setMessage({ kind: "warn", text: error?.message || "Ranking failed" });
    } finally {
      setBusy(false);
    }
  };

  /**
   * Bind an unmatched model to a leaderboard entry, then re-rank immediately.
   *
   * An empty slug is recorded as an explicit key rather than deleted: the server
   * treats key presence as "the user decided", so this is what stops a cleared
   * row from being auto-bound again on the next pass.
   */
  const handleBind = (modelStr, slug) => {
    const next = { ...bindings, [modelStr]: slug || "" };
    setBindings(next);
    handleApply(next);
  };

  /**
   * Drop every remembered match. A remembered binding is only useful while it is
   * correct, so a wrong one must be removable rather than permanent.
   */
  const forgetBindings = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/aa/rank", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setBindings({});
      setMessage({ kind: "ok", text: "Forgot all remembered model matches." });
    } catch (error) {
      setMessage({ kind: "warn", text: error?.message || "Could not clear remembered matches" });
    } finally {
      setBusy(false);
    }
  };

  const rememberedCount = Object.keys(bindings).length;
  const hasSnapshot = (status?.count || 0) > 0;

  return (
    <div className="mt-2 rounded-lg border border-black/10 dark:border-white/10 p-2 flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="material-symbols-outlined text-text-muted" style={{ fontSize: "14px" }}>leaderboard</span>
        <span className="text-[11px] font-medium">Rank by capability</span>

        <select
          value={preset}
          onChange={(e) => setPreset(e.target.value)}
          disabled={!hasSnapshot || busy}
          className="ml-auto bg-surface border border-border rounded px-1.5 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-50"
        >
          {presets.map((p) => (
            <option key={p.key} value={p.key} title={p.description}>{p.label}</option>
          ))}
        </select>

        <button
          onClick={() => handleApply()}
          disabled={!hasSnapshot || busy || models.length === 0}
          className="px-2 py-0.5 rounded border border-border text-[11px] hover:border-primary/50 hover:text-primary disabled:opacity-40 disabled:cursor-not-allowed hover:cursor-pointer"
        >
          Apply
        </button>
        <button
          onClick={handleSync}
          disabled={busy}
          className="px-2 py-0.5 rounded border border-border text-[11px] hover:border-primary/50 hover:text-primary disabled:opacity-40 hover:cursor-pointer"
        >
          {busy ? "Working…" : hasSnapshot ? "Re-sync" : "Sync"}
        </button>
        {rememberedCount > 0 && (
          <button
            onClick={forgetBindings}
            disabled={busy}
            title={`${rememberedCount} model match${rememberedCount === 1 ? "" : "es"} remembered from earlier runs - click to forget them all`}
            className="px-2 py-0.5 rounded border border-border text-[11px] text-text-muted hover:border-amber-500/50 hover:text-amber-500 disabled:opacity-40 hover:cursor-pointer"
          >
            Forget {rememberedCount}
          </button>
        )}
      </div>

      <div className="text-[10px] text-text-muted">
        {hasSnapshot ? (
          <>
            {status.count} models · updated {status.fetchedAt ? new Date(status.fetchedAt).toLocaleDateString() : "unknown"}
            {status.stale && <span className="text-amber-500"> · data is stale, re-sync recommended</span>}
            {status.needsResync && (
              <span className="text-amber-500">
                {" "}· this snapshot predates the current benchmarks — re-sync to enable the dimensions
              </span>
            )}
          </>
        ) : (
          <>No leaderboard data yet — sync to enable ranking.</>
        )}
      </div>

      {/* Which leaderboards feed the consensus, and the budget each holds. */}
      {(status?.sources || []).length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          {status.sources.map((source) => (
            <span
              key={source.id}
              title={`${source.description}\n${source.operator} · ${source.boards} board${source.boards === 1 ? "" : "s"} · ${Math.round(source.budget * 100)}% of the evidence budget${source.count > 0 ? ` · ${source.count} models` : ""}${source.fetchedAt ? ` · updated ${new Date(source.fetchedAt).toLocaleDateString()}` : ""}${source.implemented ? "" : "\nNo adapter yet — this budget stays reserved, never reassigned."}`}
              className={`text-[9px] rounded px-1 border ${
                source.count > 0
                  ? source.stale
                    ? "border-amber-500/40 text-amber-500"
                    : "border-emerald-500/40 text-emerald-600"
                  : "border-border text-text-muted/60"
              }`}
            >
              {source.label} {Math.round(source.budget * 100)}%
              {source.count > 0 ? ` (${source.count})` : source.implemented ? " (none)" : " (n/a)"}
            </span>
          ))}
        </div>
      )}

      {message && (
        <div className={`text-[10px] ${message.kind === "ok" ? "text-emerald-500" : "text-amber-500"}`}>
          {message.text}
        </div>
      )}

      {unmatched.length > 0 && (
        <div className="flex flex-col gap-1 pt-0.5 border-t border-black/5 dark:border-white/5">
          <span className="text-[10px] text-amber-500">
            {unmatched.length} model{unmatched.length === 1 ? "" : "s"} the leaderboard could not
            confirm. The closest match was applied where one was found — review, correct, or search
            the full catalog. Your choices are remembered for next time.
          </span>
          {unmatched.map((modelStr) => (
            <RankingBindRow
              key={modelStr}
              modelStr={modelStr}
              value={
                Object.prototype.hasOwnProperty.call(bindings, modelStr)
                  ? bindings[modelStr]
                  : autoBound[modelStr] || ""
              }
              suggestions={suggestions[modelStr] || []}
              isAuto={Boolean(autoBound[modelStr]) && !Object.prototype.hasOwnProperty.call(bindings, modelStr)}
              disabled={busy}
              onBind={handleBind}
            />
          ))}
        </div>
      )}
    </div>
  );
}

ComboRankingBar.propTypes = {
  models: PropTypes.arrayOf(PropTypes.string).isRequired,
  onReorder: PropTypes.func.isRequired,
};
